# Claude Workflow OS

[English](./README.md) · **한국어**

[Claude Code](https://docs.claude.com/claude-code)를 위한 로컬 관제 도구. 여러 `~/.claude` 프로젝트를 한 화면에서 전환하고, 라이브 세션을 보고, 칸반보드로 티켓을 관리하고, 에이전트가 막혔을 때 푸시 알림을 받는다 — 전부 단일 대시보드에서.

> 상태: 초기. 개인 용도로 만든 의견적인 도구지만, 포크해서 쓰기 좋게 투명하게 공개한다.

## 무엇을 할 수 있나

- **자동 티켓 워커** — `instrumentation.ts`가 프로세스당 한 번 `lib/ticket-worker.ts`의 `startTicketWorker()`를 호출. OPEN 티켓을 픽업해 `work-ticket` 스킬로 `claude -p`를 detached spawn하고, 멈춘/비정상 종료된 워커는 `REVIEW`로 회수한다. 동시성과 watchdog 분은 설정에서 조절.
- **인-페이지 Claude 챗봇** — `ChatBotWidget` 단일 위젯 + `/api/chat/*` (spawn + SSE + abort + history). 여러 탭이 같은 turn에 SSE로 join 가능, 신규 구독자는 진행 중 turn 스냅샷을 init으로 받는다.
- **다중 프로젝트 스위처** — `.claude/` 디렉토리가 있는 어떤 폴더든 등록 가능. 세션·에이전트·스킬·설정이 프로젝트별로 분리된다.
- **라이브 세션 뷰어** — 모든 Claude Code 세션 jsonl을 파싱해 태스크·대화·편집 파일·타임라인·트레이스·스윔레인·통계·원본 뷰로 노출. 태스크는 SSE로 실시간 갱신.
- **서브에이전트 통합** — Claude Code는 서브에이전트(Agent/Task 도구) 작업을 `<sessionId>/subagents/agent-*.jsonl` 별도 파일에 저장. 뷰어가 메인 jsonl과 합쳐서 Trace에서는 부모 Agent 아래로 nesting하고, Timeline·대화·편집 파일에는 violet "서브에이전트" 배지로 표시. 메인/서브/전체로 나누는 필터 탭 제공.
- **티켓 칸반** — `OPEN → IN_PROGRESS → REVIEW → DONE` 상태 머신 + `blocked`/`blockedReason`. 티켓은 `tickets/`의 평문 JSON이라 사람이 직접 열어보거나 수정 가능.
- **Web Push** — 티켓이 `REVIEW`로 진입하거나, 진행 중 티켓이 `blocked`되면 브라우저/OS 알림. 탭이 닫혀 있어도 동작.
- **알림 센터** — 모든 mutation(티켓 전이, 프로젝트 생성, 세션 이어가기 등)이 카테고리별 알림 발송. 클릭하면 해당 페이지로 딥링크.
- **내장 모니터링** — `/api/metrics`가 `prom-client` 기반 Prometheus 익스포지션을 노출, `/monitoring` 페이지가 자체 차트(CPU·RSS·이벤트 루프 지연·라우트별 p99 레이턴시·요청률·캐시 히트율)를 그려줌. Grafana 없이 작동. 호버 crosshair, 범례 솔로 토글, 메트릭 제목에 HELP 텍스트 툴팁 지원.
- **서버 헬스 오버레이** — 모든 페이지가 `/api/health`를 폴링. 서버가 죽으면 UI가 흐려지면서 재연결 안내.
- **URL이 뷰 상태의 진실 원천** — 활성 프로젝트·탭·강조 태스크는 `?project=`/`?tab=`/`?taskId=`. 북마크·딥링크·뒤로가기가 자연스럽게 동작.

## 스택

| 레이어 | 선택 |
|---|---|
| 프레임워크 | Next.js 16 (App Router, Node runtime) |
| 언어 | TypeScript strict |
| 패키지 매니저 | **pnpm** |
| UI | Tailwind v4 + 자체 프리미티브 (`app/components/ui`) |
| 데이터 | 평문 JSON (`tickets/*.json`, `~/.claude/**`) |
| 실시간 | SSE (파일시스템 watcher → in-process EventEmitter) |
| 푸시 | `web-push` (VAPID) |
| 메트릭 | `prom-client` |
| 검증 | `zod` (HTTP 경계 전용) |

DB 없음. 인증 없음. 푸시용 VAPID 키 외에 외부 서비스 의존 없음.

## 요구사항

- **Node 20+**
- **pnpm 10+**
- `claude` CLI가 `$PATH`에 있는 Claude Code 설치 (실행/이어가기 액션용)
- "새 터미널에서 실행"/"새 터미널에서 이어가기"는 **macOS 전용** (Terminal.app/iTerm/Ghostty AppleScript 사용). 그 외 기능은 플랫폼 무관.

## 빠른 시작

```bash
git clone <fork URL>
cd claude-workflow-os
pnpm install

# 선택: Web Push 활성화
npx web-push generate-vapid-keys
cp .env.example .env.local
# 생성된 키를 .env.local에 붙여넣기

pnpm dev
```

<http://localhost:3000>을 연다. 글로벌 `~/.claude`가 자동으로 **ALL** 프로젝트로 등록되어 있다. 추가 프로젝트는 인앱 스위처에서.

## 디렉토리 구조

```
app/
├── dashboard/          # 메인 화면 — 세션 + 컨텍스트 + 티켓
├── board/              # 티켓 칸반
├── monitoring/         # Prometheus 자체 차트
├── settings/
├── sessions/[id]/      # 세션 상세 (태스크·대화·트레이스 등)
├── components/
│   ├── ui/             # zinc/slate 프리미티브 (도메인 모름)
│   ├── notifications/  # provider, bell, toast stack
│   ├── use-*.ts        # 도메인 훅 (use-tickets, use-sessions 등)
│   └── *-client.ts     # axios 어댑터
└── api/
    ├── tickets, projects, sessions, settings, …
    ├── health          # ServerHealthOverlay 폴링용
    └── metrics         # Prometheus exposition

lib/
├── cache.ts            # createCache(name) — Prometheus 메트릭 자동 노출
├── metrics.ts          # prom-client registry + withMetrics(route, handler)
├── sessions.ts         # ~/.claude/projects 스캔
├── session-lookup.ts   # sessionId → jsonl path 캐시
├── session-tasks.ts    # 라이브 + 리플레이 태스크 타임라인
├── session-watcher.ts  # SSE 소스: jsonl tail
├── session-extras.ts   # jsonl을 뷰로 파싱
├── ticket-store.ts     # 티켓 CRUD + 상태 머신 + 이벤트 버스
└── …

tickets/                # 티켓 JSON 저장소 (.example.json 외 gitignore)
docs/rules/             # 아키텍처 규칙 — 기여 전 필독
```

## 한 화면에서 보는 아키텍처

- **라우트는 얇다**. 모든 `/api/*`는 `parse → lib 호출 → 응답`만 하고 `withMetrics(routePattern, handler)`로 감싸 무료로 히스토그램·카운터를 얻는다.
- **관심사별 단일 진실 원천**. 티켓은 `lib/ticket-store.ts`, 푸시는 `lib/web-push.ts`, SSE 버스는 `lib/session-watcher.ts`. 교차 import 없음.
- **URL이 뷰 상태의 진실 원천**. 탭/프로젝트/강조 id에 `localStorage` 사용 금지. `useSearchParams`가 읽고 `router.replace`가 쓴다.
- **TanStack Query가 클라이언트 캐시**. SSE 이벤트는 `setQueryData`로 머지, refetch 트리거하지 않는다.
- **mtime 기반 캐시**. `~/.claude/**` 읽는 모든 함수는 `createCache(name)`을 통한다. 단일 파일 캐시는 `(path, mtimeMs, size)`, 세션 합본 캐시는 모든 구성 파일을 합친 fingerprint를 키로 쓴다. 히트/미스/사이즈가 자동으로 Prometheus에 흐른다.
- **Conditional GET (304)**. 큰 세션 본문은 `ETag = "<schemaVersion>-<hash>"`. 브라우저가 자동으로 revalidate하고, 변경 없으면 서버가 본문 없이 304 반환. 응답 shape이 바뀔 때 schemaVersion을 bump하면 클라 캐시 자동 무효화.
- **서브에이전트 합본**. `readSessionBundle(mainPath)`이 메인 jsonl + 모든 `<id>/subagents/agent-*.jsonl`을 합쳐 본문 + fingerprint를 반환. 파일 순서가 시간순이 아니라서 파서는 `ts`로 정렬 필수. `buildSubagentParentMap`이 promptId + meta.json description으로 부모 Agent tool_use_id를 확정 (불안정한 텍스트 매칭 X).
- **메트릭 엔드포인트** Node 기본 + `http_request_duration_seconds` 히스토그램 + 라우트별 카운터 + 캐시별 `cache_*` 노출.

전체 컨벤션은 [`docs/rules/`](./docs/rules/) 참조 — [`api.md`](./docs/rules/api.md), [`components.md`](./docs/rules/components.md), [`performance.md`](./docs/rules/performance.md)부터.

## 설정

| 환경변수 | 용도 |
|---|---|
| `CLAUDE_PROJECT_ROOT` | 글로벌 Claude 루트 오버라이드 (기본 `~/.claude`). 테스트용. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push. 선택. 아래 참조. |

앱 설정(터미널 앱·기본 프롬프트·권한 모드 등)은 `~/.claude/.workflow-os.json`에 저장되며 인앱 설정 페이지에서 편집한다.

### Web Push 설정 (선택)

VAPID 키 없이도 앱은 동작한다 — 푸시 구독 엔드포인트만 noop. 실제 OS 알림을 켜려면:

```bash
# 1. 새 VAPID 키 페어 생성 (Anthropic/Google 계정 불필요, web-push는 자체 호스팅).
npx web-push generate-vapid-keys

# 2. .env.local로 옮긴다. .gitignore가 .env*를 이미 제외하니 절대 커밋 금지.
cp .env.example .env.local
$EDITOR .env.local
```

`.env.local` 형태:

```dotenv
VAPID_PUBLIC_KEY=BJq...   # 1단계의 public key
VAPID_PRIVATE_KEY=...     # 1단계의 private key — 비밀 유지
VAPID_SUBJECT=mailto:you@example.com   # 푸시 서비스에 식별자로 보낼 URL 또는 mailto:
```

`pnpm dev` 재시작 후 앱에서 종 아이콘 → 알림 켜기를 브라우저당 1회 클릭. 브라우저가 구독을 로컬에 저장하므로 재시작에도 살아남는다.

**키 안전**: private key가 모든 푸시에 서명한다. 유출되면 누구나 그 public key로 구독한 클라이언트에 푸시를 보낼 수 있다 — 두 키 모두 재생성하고 사용자에게 재구독을 요청해 로테이션.

## 티켓

티켓은 `tickets/` 하위 JSON 파일이다. 디렉토리는 사용자별 데이터라 gitignore되어 있고 — `tickets/.example.json`이 store와 HTTP API가 기대하는 형태를 보여준다.

## 스크립트

```bash
pnpm dev           # next dev (hot reload)
pnpm build         # production build
pnpm start         # production server
pnpm lint          # eslint
```

## 기여

`docs/rules/` 규칙을 따르는 PR은 환영한다.

1. [`docs/rules/api.md`](./docs/rules/api.md), [`components.md`](./docs/rules/components.md), [`performance.md`](./docs/rules/performance.md)을 먼저 읽는다.
2. `pnpm lint`가 통과해야 한다 — 프로젝트의 PostToolUse 훅(`.claude/settings.json`)이 저장 시 대부분 자동 수정.
3. 새 `/api/*` 라우트는 `withMetrics`로 wrap. 새 캐시는 `createCache` 사용.
4. 모든 export 함수/타입/스키마 필드에 JSDoc — 권장이 아니라 규칙.

## 라이선스

MIT.
