import { FileTextIcon } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type Source, useSources } from "@/state/sources";

/** One chip per document used in the latest answer; tap to read the passages. */
export function SourceChips({ className }: { className?: string }) {
  const latest = useSources((s) => s.latest);
  const setOpen = useSources((s) => s.setOpen);
  if (!latest.length) return null;
  const byDoc = new Map<string, Source[]>();
  latest.forEach((s) => byDoc.set(s.title, [...(byDoc.get(s.title) ?? []), s]));
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-muted-foreground text-xs">Sources</span>
      {[...byDoc.entries()].map(([title, chunks]) => (
        <button
          key={title}
          onClick={() => setOpen(chunks[0])}
          className="bg-secondary/80 hover:bg-secondary text-secondary-foreground flex max-w-[16rem] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition active:scale-95"
        >
          <FileTextIcon className="size-3.5 shrink-0" />
          <span className="truncate">{title || "Document"}</span>
          {chunks.length > 1 && <span className="text-muted-foreground">×{chunks.length}</span>}
        </button>
      ))}
    </div>
  );
}

export function SourceDialog() {
  const open = useSources((s) => s.open);
  const latest = useSources((s) => s.latest);
  const setOpen = useSources((s) => s.setOpen);
  const passages = open ? latest.filter((s) => s.title === open.title) : [];
  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <FileTextIcon className="size-4 shrink-0" />
            <span className="truncate">{open?.title}</span>
          </DialogTitle>
          <DialogDescription>Passages used for this answer</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {passages.map((p) => (
            <p key={p.chunk_id} className="bg-muted/50 rounded-lg p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {p.chunk.trim()}
            </p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
