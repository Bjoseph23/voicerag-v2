import { useAuiState, useVoiceControls, useVoiceState } from "@assistant-ui/react";
import { MicIcon, MicOffIcon, PhoneOffIcon } from "lucide-react";

import { deriveVoiceOrbState, VoiceOrb } from "@/components/assistant-ui/elements/voice.aui";
import { cn } from "@/lib/utils";

import { SourceChips } from "./sources";

const LABEL: Record<string, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Speaking",
  muted: "Muted",
  idle: "",
};

/** Full-screen voice mode: big orb, live captions, sources, mute and hang up. */
export function CallView() {
  const voice = useVoiceState();
  const { mute, unmute, disconnect } = useVoiceControls();
  // Selectors must return primitives: a new object each time would re-render forever (React #185).
  const lastRole = useAuiState((s) => {
    const m = s.thread.messages.at(-1);
    return m?.metadata.modality === "voice" ? m.role : null;
  });
  const lastText = useAuiState((s) => {
    const m = s.thread.messages.at(-1);
    return m?.metadata.modality === "voice" ? m.content.map((p) => (p.type === "text" ? p.text : "")).join("") : "";
  });
  const last = lastRole ? { role: lastRole, text: lastText } : null;
  const active = voice && voice.status.type !== "ended";
  if (!active) return null;
  const state = deriveVoiceOrbState(voice);

  return (
    <div role="dialog" aria-label="Voice call" className="bg-background/95 animate-in fade-in fixed inset-0 z-40 flex flex-col items-center justify-between px-6 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] backdrop-blur-xl">
      <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium tracking-wide">
        <span className={cn("size-2 rounded-full", state === "speaking" ? "bg-violet-400" : state === "listening" ? "animate-pulse bg-emerald-400" : "bg-muted-foreground")} />
        {LABEL[state]}
      </div>

      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8">
        <VoiceOrb variant="violet" className="size-56 sm:size-72" />
        <p
          aria-live="polite"
          className={cn(
            "line-clamp-4 min-h-[5.5rem] text-center text-lg leading-relaxed text-balance transition-opacity",
            last?.role === "user" ? "text-muted-foreground italic" : "text-foreground",
            !last?.text && "opacity-0",
          )}
        >
          {last?.text || "…"}
        </p>
        <SourceChips className="justify-center" />
      </div>

      <div className="flex items-center gap-6">
        <button
          onClick={() => (voice.isMuted ? unmute() : mute())}
          aria-label={voice.isMuted ? "Unmute" : "Mute"}
          className={cn("flex size-16 items-center justify-center rounded-full border transition active:scale-95", voice.isMuted ? "bg-foreground text-background" : "bg-secondary")}
        >
          {voice.isMuted ? <MicOffIcon className="size-6" /> : <MicIcon className="size-6" />}
        </button>
        <button
          onClick={disconnect}
          aria-label="End call"
          className="flex size-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/30 transition active:scale-95"
        >
          <PhoneOffIcon className="size-6" />
        </button>
      </div>
    </div>
  );
}

export function CallButton({ className, label }: { className?: string; label?: string }) {
  const { connect } = useVoiceControls();
  const voice = useVoiceState();
  const busy = voice?.status.type === "starting";
  return (
    <button
      type="button"
      onClick={() => connect()}
      disabled={busy}
      aria-label="Start voice conversation"
      className={cn(
        "flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 active:scale-95 disabled:opacity-60",
        label ? "h-12 px-6 text-base font-medium" : "size-8 justify-center",
        className,
      )}
    >
      <MicIcon className={label ? "size-5" : "size-4"} />
      {label}
    </button>
  );
}

/** Shows why a call ended with an error (mic denied, server down…). */
export function VoiceError() {
  const voice = useVoiceState();
  if (voice?.status.type !== "ended" || voice.status.reason !== "error") return null;
  const err = voice.status.error;
  return (
    <div role="alert" className="mx-auto mb-2 w-full max-w-2xl rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      Voice call failed: {err instanceof Error ? err.message : "unknown error"}
    </div>
  );
}
