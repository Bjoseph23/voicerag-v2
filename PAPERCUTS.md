# PAPERCUTS
<!-- Agents append a row whenever something fails or needs a workaround. Don't fix silently; log it.
     Weekly (`codify` skill): turn repeated rows into an AGENTS.md rule, a script, or a hook, then set status to `codified`. -->

| date | what failed | workaround | status |
|------|-------------|------------|--------|
| 2026-11-12 | `uv add` failed: 'wheel is invalid: Metadata field Name not found' (multidict, yarl) | `uv add --no-cache ...` (corrupt uv cache) | open |
| 2026-11-12 | Search tool error 'semantic search is not enabled' | Free Search tier has no semantic ranker: leave AZURE_SEARCH_SEMANTIC_CONFIGURATION empty | fixed |
| 2026-11-12 | shadcn init (base-nova) wrote `lib/utils.ts` re-exporting from package "cn"; assistant-ui tooltip used Radix `delayDuration` | Standard clsx+twMerge utils; `delay` prop | fixed |
| 2026-11-12 | Uploads: AuthorizationPermissionMismatch (az login OK but no data role) | Granted Bill 'Storage Blob Data Contributor' on softwizfoundryst (Bill approved); ~2 min to propagate | fixed |
| 2026-11-12 | `pkill -f <pattern>` inside an agent Bash call killed the agent's own shell (pattern is in its command line) | Kill by port/PID (`ss -ltnp`) instead | open |
