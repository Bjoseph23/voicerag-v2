import { create } from "zustand";

export type Source = { chunk_id: string; title: string; chunk: string };

type SourcesState = {
  latest: Source[];
  open: Source | null;
  setLatest: (s: Source[]) => void;
  setOpen: (s: Source | null) => void;
};

export const useSources = create<SourcesState>((set) => ({
  latest: [],
  open: null,
  setLatest: (latest) => set({ latest }),
  setOpen: (open) => set({ open }),
}));

/** The model sometimes writes citation labels like [S1] into text; hide them. */
export const cleanCitations = (text: string) => text.replace(/\s*[[(【]\s*S\d+(\s*[,;]\s*\[?S\d+\]?)*\s*[\])】]/g, "").replace(/\s+([.,!?])/g, "$1").replace(/[\s-]*-{3,}\s*$/, "").replace(/<\/?result[^>]*>/g, "");
