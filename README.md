# Claude Workflow OS

**English** · [한국어](./README.ko.md)

Local control plane for [Claude Code](https://docs.claude.com/claude-code). Run multiple `~/.claude` projects, watch live sessions, manage tickets on a kanban board, and get push-notified when an agent gets stuck — all from a single dashboard.

> Status: early. Built for personal use, opinionated, but transparent enough to fork.

## What you get

- **Automatic ticket worker** — `instrumentation.ts` boots `lib/ticket-worker.ts` once per process, which picks up `OPEN` tickets, spawns a detached `claude -p` per ticket via the `work-ticket` skill, and recovers stuck or abnormally-exited workers into `REVIEW`. Concurrency and watchdog timeout are settings.
- **In-page Claude chatbot** — `ChatBotWidget` is a single-entrypoint widget backed by `/api/chat/*` (spawn + SSE + abort + history). Multiple tabs can attach to the same turn via SSE and receive a snapshot on subscribe.
- **Multi-project switcher** — register any folder containing a `.claude/` directory. Sessions, agents, skills, and settings are scoped per project.
- **Live session viewer** — every Claude Code session JSONL is parsed and surfaced as Tasks · Conversation · Edited files · Timeline · Trace · Swimlane · Stats · Raw views. Tasks update in real time over SSE.
- **Subagent integration** — Claude Code stores subagent (Agent/Task tool) work in separate `<sessionId>/subagents/agent-*.jsonl` files. The viewer merges them with the main jsonl, nests subagent tool chains under their parent Agent in the Trace view, and tags them with a violet "서브에이전트" badge across Timeline / Conversation / Edited Files. Filter tabs split per-source (main / subagent / all).
- **Ticket kanban** — `OPEN → IN_PROGRESS → REVIEW → DONE` with `blocked` / `blockedReason`. Tickets are plain JSON files in `tickets/`, easy to inspect or hand-edit.
- **Web Push** — get a browser/OS notification when a ticket enters `REVIEW` or an in-progress ticket is marked `blocked`. Works while the tab is closed.
- **Notification center** — every mutation (ticket transition, project create, session resume, …) emits a categorized notification. Click to deep-link back to the relevant page.
- **Built-in monitoring** — `/api/metrics` exposes Prometheus exposition (via `prom-client`); the `/monitoring` page renders self-hosted charts (CPU, RSS, event-loop lag, per-route p99 latency, request rate, cache hit rate) without Grafana. Hover crosshair, legend solo-toggle, and HELP-text tooltips on metric titles.
- **Server health overlay** — every page polls `/api/health`; if the server stops responding, the UI dims with a clear "reconnect" prompt.
- **URL is the view-state truth** — active project, tab, highlighted task all live in `?project=` / `?tab=` / `?taskId=`. Bookmarks, deep links, and the back button all just work.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Node runtime) |
| Language | TypeScript strict |
| Package manager | **pnpm** |
| UI | Tailwind v4 + in-house primitives (`app/components/ui`) |
| Data | Plain JSON files (`tickets/*.json`, `~/.claude/**`) |
| Realtime | SSE (file-system watcher → in-process EventEmitter) |
| Push | `web-push` (VAPID) |
| Metrics | `prom-client` |
| Validation | `zod` (HTTP boundary only) |

No database. No auth. No external services beyond optional VAPID keys for push.

## Requirements

- **Node 20+**
- **pnpm 10+**
- A Claude Code installation (`claude` CLI on `$PATH`) for the launch / resume actions
- **macOS** for "launch in new terminal" / "resume in new terminal" (uses Terminal.app / iTerm / Ghostty AppleScript). Other features are platform-neutral.

## Quick start

```bash
git clone <your fork>
cd claude-workflow-os
pnpm install

# Optional: enable Web Push
npx web-push generate-vapid-keys
cp .env.example .env.local
# paste the keys into .env.local

pnpm dev
```

Open <http://localhost:3000>. The global `~/.claude` is registered as the **ALL** project automatically. Add more projects from the in-app switcher.

## Project layout

```
app/
├── dashboard/          # main view: sessions + context + tickets
├── board/              # ticket kanban
├── monitoring/         # Prometheus self-rendered charts
├── settings/
├── sessions/[id]/      # session detail (tasks, conversation, trace, …)
├── components/
│   ├── ui/             # zinc/slate primitives, no domain types
│   ├── notifications/  # provider, bell, toast stack
│   ├── use-*.ts        # domain hooks (use-tickets, use-sessions, …)
│   └── *-client.ts     # axios adapters
└── api/
    ├── tickets, projects, sessions, settings, …
    ├── health          # used by ServerHealthOverlay
    └── metrics         # Prometheus exposition

lib/
├── cache.ts            # createCache(name) — Prometheus-instrumented in-memory cache
├── metrics.ts          # prom-client registry + withMetrics(route, handler)
├── sessions.ts         # ~/.claude/projects scanning
├── session-lookup.ts   # sessionId → jsonl path cache
├── session-tasks.ts    # live + replayed task timeline
├── session-watcher.ts  # SSE source: tails jsonl files
├── session-extras.ts   # parse jsonl into views
├── ticket-store.ts     # ticket CRUD + state machine + event bus
└── …

tickets/                # ticket JSON storage (gitignored except .example.json)
docs/rules/             # architecture rules — read these before contributing
```

## Architecture in one screen

- **Routes are thin.** Every `/api/*` handler does `parse → call lib → respond` and is wrapped in `withMetrics(routePattern, handler)` for free histograms / counters.
- **Single source of truth per concern.** Tickets in `lib/ticket-store.ts`. Push in `lib/web-push.ts`. SSE bus in `lib/session-watcher.ts`. No cross-imports.
- **URL is the view-state truth.** No `localStorage` for tabs / projects / highlights. `useSearchParams` reads, `router.replace` writes.
- **TanStack Query is the client cache.** SSE events merge via `setQueryData`, never trigger a refetch.
- **mtime-based caches.** Anything reading from `~/.claude/**` is keyed through `createCache(name)`. Single-file caches use `(path, mtimeMs, size)`; bundled session caches use a fingerprint over all member files. Hit / miss / size flow into Prometheus automatically.
- **Conditional GET (304).** Large session bodies use `ETag = "<schemaVersion>-<hash>"`. Browsers revalidate; server returns 304 with no body when unchanged. Bumping `schemaVersion` busts client cache when response shape evolves.
- **Subagent bundle.** `readSessionBundle(mainPath)` concatenates main jsonl + every `<id>/subagents/agent-*.jsonl` and returns one body + fingerprint. Parsers must sort by `ts` (file order ≠ chronological).  `buildSubagentParentMap` resolves agent → parent Agent tool_use_id via promptId + meta.json description (no fragile text matching).
- **Metrics endpoint exposes** Node defaults + `http_request_duration_seconds` histogram + per-route counters + `cache_*` per named cache.

For full conventions read [`docs/rules/`](./docs/rules/) — start with [`api.md`](./docs/rules/api.md), [`components.md`](./docs/rules/components.md), and [`performance.md`](./docs/rules/performance.md).

## Configuration

| Env var | Purpose |
|---|---|
| `CLAUDE_PROJECT_ROOT` | Override the global Claude root (defaults to `~/.claude`). Useful for tests. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push. Optional. See below. |

App-level settings (terminal app, default prompt, permission mode, …) live at `~/.claude/.workflow-os.json` and are edited from the in-app Settings page.

### Setting up Web Push (optional)

Without VAPID keys the app still runs — push subscription endpoints just no-op. To enable real OS-level notifications:

```bash
# 1. Generate a fresh VAPID key pair (no Anthropic / Google account needed; web-push is self-hosted).
npx web-push generate-vapid-keys

# 2. Drop them into .env.local. .gitignore already excludes .env*; do not commit these.
cp .env.example .env.local
$EDITOR .env.local
```

`.env.local` should look like:

```dotenv
VAPID_PUBLIC_KEY=BJq...   # public key from step 1
VAPID_PRIVATE_KEY=...     # private key from step 1 — keep secret
VAPID_SUBJECT=mailto:you@example.com   # any URL or mailto: identifying you to push services
```

Then restart `pnpm dev`, open the app, and click the bell icon → enable notifications once per browser. The browser stores the subscription locally; push endpoints survive restarts.

**Key safety**: the private key signs every push. If it leaks, anyone can send pushes to clients that subscribed against your public key — rotate by regenerating both keys and asking users to re-subscribe.

## Tickets

Tickets are JSON files under `tickets/`. The directory is gitignored (per-user data) — `tickets/.example.json` shows the shape expected by the store and HTTP API.

## Scripts

```bash
pnpm dev           # next dev (hot reload)
pnpm build         # production build
pnpm start         # production server
pnpm lint          # eslint
```

## Contributing

PRs that respect the rules under `docs/rules/` are welcome.

1. Read [`docs/rules/api.md`](./docs/rules/api.md), [`components.md`](./docs/rules/components.md), [`performance.md`](./docs/rules/performance.md).
2. `pnpm lint` must pass — the project's PostToolUse hook (`.claude/settings.json`) auto-fixes most things on save.
3. New `/api/*` routes go through `withMetrics`. New caches go through `createCache`.
4. Add JSDoc to every exported function, type, and schema field — the rule isn't aspirational.

## License

MIT.
