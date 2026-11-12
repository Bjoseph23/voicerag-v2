import { AlertCircleIcon, CheckCircle2Icon, FileTextIcon, Loader2Icon, RefreshCwIcon, Trash2Icon, UploadCloudIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, type AppConfig, type Doc } from "@/lib/api";
import { cn } from "@/lib/utils";

const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

const STATE = {
  ready: { icon: CheckCircle2Icon, label: "Ready", cls: "text-emerald-400" },
  indexing: { icon: Loader2Icon, label: "Indexing…", cls: "text-amber-400 [&>svg]:animate-spin" },
  error: { icon: AlertCircleIcon, label: "Failed", cls: "text-red-400" },
} as const;

export function DocumentsPanel({ config }: { config: AppConfig | null }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.listDocs();
      setDocs(r.documents);
      setErrors(r.indexer.errors.map((e) => e.message));
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
      setDocs((d) => d ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while anything is still indexing.
  const indexing = docs?.some((d) => d.state === "indexing");
  useEffect(() => {
    if (!indexing) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [indexing, refresh]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    const maxBytes = (config?.max_upload_mb ?? 25) * 1024 * 1024;
    const tooBig = files.find((f) => f.size > maxBytes);
    if (tooBig) return setMessage({ kind: "error", text: `${tooBig.name} is over ${config?.max_upload_mb ?? 25} MB` });
    setBusy("upload");
    setMessage(null);
    try {
      const r = await api.upload(files);
      setMessage({ kind: "info", text: `Uploaded ${r.uploaded.length} file${r.uploaded.length > 1 ? "s" : ""}. Indexing takes up to ~3 minutes (free Search tier).` });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete "${name}"? The assistant will no longer know its contents.`)) return;
    setBusy(name);
    try {
      await api.remove(name);
      setDocs((d) => d?.filter((x) => x.name !== name) ?? null);
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold">Your documents</h2>
          <p className="text-muted-foreground text-sm">The assistant answers only from these.</p>
        </div>
        <button onClick={() => void refresh()} aria-label="Refresh" className="text-muted-foreground hover:text-foreground rounded-full p-2 transition active:scale-95">
          <RefreshCwIcon className="size-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload([...e.dataTransfer.files]);
        }}
        disabled={busy === "upload"}
        className={cn(
          "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition active:scale-[0.99]",
          dragging ? "border-violet-400 bg-violet-500/10" : "border-border hover:border-violet-400/60 hover:bg-violet-500/5",
        )}
      >
        {busy === "upload" ? <Loader2Icon className="size-8 animate-spin text-violet-400" /> : <UploadCloudIcon className="size-8 text-violet-400" />}
        <span className="font-medium">{busy === "upload" ? "Uploading…" : "Tap to upload or drop files"}</span>
        <span className="text-muted-foreground text-xs">PDF, Word, PowerPoint, Excel, Markdown, text · up to {config?.max_upload_mb ?? 25} MB</span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={config?.allowed_extensions.join(",")}
        onChange={(e) => void upload([...(e.target.files ?? [])])}
      />

      {message && (
        <div role="status" className={cn("rounded-lg border px-3 py-2 text-sm", message.kind === "error" ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-violet-500/30 bg-violet-500/10")}>
          {message.text}
        </div>
      )}

      <ul className="divide-border bg-card divide-y overflow-hidden rounded-2xl border">
        {docs === null && <li className="text-muted-foreground p-4 text-sm">Loading…</li>}
        {docs?.length === 0 && <li className="text-muted-foreground p-4 text-sm">No documents yet. Upload one to get started.</li>}
        {docs?.map((d) => {
          const st = STATE[d.state];
          return (
            <li key={d.name} className="flex items-center gap-3 px-4 py-3">
              <FileTextIcon className="text-muted-foreground size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className={cn("flex items-center gap-1 text-xs", st.cls)}>
                  <st.icon className="size-3" />
                  {st.label}
                  <span className="text-muted-foreground">· {fmtSize(d.size)}</span>
                </p>
              </div>
              <button
                onClick={() => void remove(d.name)}
                disabled={busy === d.name}
                aria-label={`Delete ${d.name}`}
                className="text-muted-foreground rounded-full p-2 transition hover:text-red-400 active:scale-95 disabled:opacity-50"
              >
                {busy === d.name ? <Loader2Icon className="size-4 animate-spin" /> : <Trash2Icon className="size-4" />}
              </button>
            </li>
          );
        })}
      </ul>
      {errors.length > 0 && (
        <details className="text-muted-foreground text-xs">
          <summary>Indexer reported {errors.length} issue(s)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
