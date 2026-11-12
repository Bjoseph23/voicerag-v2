export type DocState = "ready" | "indexing" | "error";
export type Doc = { name: string; size: number; modified: string; state: DocState };
export type DocList = { documents: Doc[]; indexer: { running: boolean; last_status: string | null; errors: { key: string; message: string }[] } };
export type AppConfig = { provider: string; model: string; voice: string; allowed_extensions: string[]; max_upload_mb: number };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  config: () => req<AppConfig>("/api/config"),
  listDocs: () => req<DocList>("/api/documents"),
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return req<{ uploaded: Doc[] }>("/api/documents", { method: "POST", body: fd });
  },
  remove: (name: string) => req<{ deleted: string }>(`/api/documents/${encodeURIComponent(name)}`, { method: "DELETE" }),
  reindex: () => req<{ ok: boolean }>("/api/documents/reindex", { method: "POST" }),
};
