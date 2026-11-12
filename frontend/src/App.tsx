import { AssistantRuntimeProvider, useLocalRuntime } from "@assistant-ui/react";
import { FolderOpenIcon, MessageCircleIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { CallButton, CallView, VoiceError } from "@/components/app/call-view";
import { DocumentsPanel } from "@/components/app/documents";
import { SourceChips, SourceDialog } from "@/components/app/sources";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, type AppConfig } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RealtimeAdapter } from "@/voice/realtime-adapter";
import { textAdapter } from "@/voice/text-adapter";

type Tab = "chat" | "docs";

function Welcome() {
  return (
    <div className="flex flex-col items-center gap-5 px-4 pt-[12dvh] text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-500/30">
        <SparklesIcon className="size-7 text-white" />
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Talk to your documents</h1>
        <p className="text-muted-foreground text-sm">Start a voice call or type a question below.</p>
      </div>
      <CallButton label="Start talking" />
    </div>
  );
}

const ComposerExtra = () => <CallButton />;

export default function App() {
  const voice = useMemo(() => new RealtimeAdapter(), []);
  const runtime = useLocalRuntime(textAdapter, { adapters: { voice } });
  const [tab, setTab] = useState<Tab>("chat");
  const [config, setConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig(null));
  }, []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <div className="bg-background text-foreground flex h-dvh flex-col">
          <header className="flex shrink-0 items-center justify-between border-b px-4 pt-[env(safe-area-inset-top)]">
            <div className="flex h-14 items-center gap-2 font-semibold">
              <span className="size-2.5 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-400" />
              VoiceRAG
              {config && <span className="text-muted-foreground hidden text-xs font-normal sm:inline">· {config.model}</span>}
            </div>
            <nav className="bg-muted flex rounded-full p-1" aria-label="Sections">
              {(
                [
                  ["chat", "Chat", MessageCircleIcon],
                  ["docs", "Documents", FolderOpenIcon],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  aria-current={tab === id}
                  className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition", tab === id ? "bg-background shadow-sm" : "text-muted-foreground")}
                >
                  <Icon className="size-4" />
                  <span className="hidden min-[380px]:inline">{label}</span>
                </button>
              ))}
            </nav>
          </header>

          <main className="relative min-h-0 flex-1">
            <div className={cn("flex h-full flex-col", tab !== "chat" && "hidden")}>
              <div className="min-h-0 flex-1">
                <Thread components={{ Welcome, ComposerExtra }} autoFocus={false} />
              </div>
              <div className="pb-[env(safe-area-inset-bottom)]">
                <VoiceError />
                <SourceChips className="mx-auto w-full max-w-2xl px-4 pb-2" />
              </div>
            </div>
            {tab === "docs" && (
              <div className="h-full overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                <DocumentsPanel config={config} />
              </div>
            )}
          </main>
        </div>
        <CallView />
        <SourceDialog />
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
