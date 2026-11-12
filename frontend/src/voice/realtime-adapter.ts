import { createVoiceSession, type RealtimeVoiceAdapter } from "@assistant-ui/react";

import { cleanCitations, useSources } from "@/state/sources";

import { Mic, Player } from "./audio";

export const realtimeUrl = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/realtime`;

type ServerEvent = { type: string; [k: string]: any };

/**
 * assistant-ui voice adapter for our own middle tier (/realtime). The server adds the prompt and tools and
 * runs document search, so the browser only streams audio and renders transcripts, audio and citations.
 */
export class RealtimeAdapter implements RealtimeVoiceAdapter {
  connect(options: { abortSignal?: AbortSignal }): RealtimeVoiceAdapter.Session {
    // Created synchronously inside the click handler so iOS Safari allows audio playback.
    const player = new Player();
    void player.unlock();

    return createVoiceSession(options, async (h) => {
      const mic = new Mic();
      const ws = new WebSocket(realtimeUrl());
      const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
      let mode: RealtimeVoiceAdapter.Mode = "listening";
      const setMode = (m: RealtimeVoiceAdapter.Mode) => {
        if (m !== mode) h.emitMode((mode = m));
      };
      player.onIdle = () => setMode("listening");

      // Hold the assistant's transcript until the user's speech transcript arrives, so the thread order is right.
      const assistantText = new Map<string, string>();
      let waitingForUser = false;
      let held: RealtimeVoiceAdapter.TranscriptItem[] = [];
      let holdTimer: ReturnType<typeof setTimeout> | undefined;
      const flushHeld = () => {
        waitingForUser = false;
        clearTimeout(holdTimer);
        held.forEach((t) => h.emitTranscript(t));
        held = [];
      };
      const emitAssistant = (t: RealtimeVoiceAdapter.TranscriptItem) => {
        if (waitingForUser) {
          held = held.filter((x) => x.isFinal);
          held.push(t);
        } else h.emitTranscript(t);
      };

      const onMessage = (e: MessageEvent<string>) => {
        const d: ServerEvent = JSON.parse(e.data);
        switch (d.type) {
          case "input_audio_buffer.speech_started": {
            const cut = player.interrupt(); // barge-in: stop talking immediately
            if (cut) send({ type: "conversation.item.truncate", item_id: cut.itemId, content_index: 0, audio_end_ms: cut.playedMs });
            setMode("listening");
            break;
          }
          case "input_audio_buffer.committed":
            waitingForUser = true;
            clearTimeout(holdTimer);
            holdTimer = setTimeout(flushHeld, 2500);
            break;
          case "conversation.item.input_audio_transcription.completed":
            if (d.transcript?.trim()) h.emitTranscript({ role: "user", text: d.transcript.trim(), isFinal: true });
            flushHeld();
            break;
          case "conversation.item.input_audio_transcription.failed":
            flushHeld();
            break;
          case "response.output_audio.delta":
            player.play(d.item_id, d.delta);
            setMode("speaking");
            break;
          case "response.output_audio_transcript.delta":
          case "response.output_text.delta": {
            const text = (assistantText.get(d.item_id) ?? "") + d.delta;
            assistantText.set(d.item_id, text);
            emitAssistant({ role: "assistant", text: cleanCitations(text), isFinal: false });
            break;
          }
          case "response.output_audio_transcript.done":
          case "response.output_text.done":
            emitAssistant({ role: "assistant", text: cleanCitations(d.transcript ?? d.text ?? assistantText.get(d.item_id) ?? ""), isFinal: true });
            assistantText.delete(d.item_id);
            break;
          case "extension.grounding":
            useSources.getState().setLatest(d.sources ?? []);
            break;
          case "error":
            console.warn("realtime error", d.error);
            break;
        }
      };

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("Could not connect to the voice server"));
      });
      ws.onmessage = onMessage;
      ws.onclose = () => {
        mic.stop();
        player.close();
        if (!h.isDisposed()) h.end("finished");
      };
      ws.onerror = () => h.end("error", new Error("Voice connection lost"));

      try {
        await mic.start(
          (audio) => send({ type: "input_audio_buffer.append", audio }),
          (rms) => mode === "listening" && h.emitVolume(Math.min(1, rms * 4)),
        );
      } catch (err) {
        ws.close();
        throw err instanceof DOMException && err.name === "NotAllowedError" ? new Error("Microphone permission was denied") : err;
      }

      const levelTimer = setInterval(() => {
        if (mode === "speaking") h.emitVolume(Math.min(1, player.level() * 4));
      }, 50);
      h.setStatus({ type: "running" });

      return {
        disconnect: () => {
          clearInterval(levelTimer);
          clearTimeout(holdTimer);
          ws.close();
        },
        mute: () => {
          mic.muted = true;
        },
        unmute: () => {
          mic.muted = false;
        },
        sendText: (text: string) => {
          player.interrupt();
          send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
          send({ type: "response.create" });
        },
      };
    });
  }
}
