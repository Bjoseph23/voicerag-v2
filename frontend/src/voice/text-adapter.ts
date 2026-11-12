import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";

import { cleanCitations, useSources } from "@/state/sources";

import { realtimeUrl } from "./realtime-adapter";

const textOf = (m: ThreadMessage) =>
  m.content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");

/** Typed chat when no voice call is active: same server, prompt and document search, text-only output. */
export const textAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const ws = new WebSocket(realtimeUrl());
    const queue: string[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let error: Error | null = null;
    const push = () => {
      wake?.();
      wake = null;
    };
    ws.onmessage = (e) => {
      const d = JSON.parse(e.data);
      if (d.type === "response.output_text.delta") queue.push(d.delta);
      else if (d.type === "extension.grounding") useSources.getState().setLatest(d.sources ?? []);
      else if (d.type === "response.done" && (d.response?.output ?? []).some((o: { type: string }) => o.type === "message")) done = true;
      else if (d.type === "error") error = new Error(d.error?.message ?? "Realtime error");
      push();
    };
    ws.onclose = () => {
      done = true;
      push();
    };
    abortSignal.addEventListener("abort", () => ws.close());
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error("Could not reach the server"));
    });
    const send = (m: object) => ws.send(JSON.stringify(m));
    send({ type: "session.update", session: { output_modalities: ["text"] } });
    for (const m of messages.slice(-12)) {
      const text = textOf(m);
      if (!text) continue;
      if (m.role === "user") send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
      else if (m.role === "assistant") send({ type: "conversation.item.create", item: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
    }
    send({ type: "response.create" });

    let text = "";
    try {
      while (!done || queue.length) {
        if (error) throw error;
        if (!queue.length) await new Promise<void>((r) => (wake = r));
        if (queue.length) {
          text += queue.splice(0).join("");
          yield { content: [{ type: "text", text: cleanCitations(text) }] };
        }
      }
    } finally {
      ws.close();
    }
  },
};
