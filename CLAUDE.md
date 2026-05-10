@AGENTS.md

# Claude Code Workflow OS

로컬에서 실행되는 Claude Code 전용 워크플로우 관제 도구.
세션·컨텍스트·티켓을 한 화면에서 관리하고, 모호한 작업이 감지되면 Web Push로 알린다.

## 기술 스택

| 역할 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) |
| 언어 | TypeScript (strict) |
| 패키지 매니저 | **pnpm** (npm/yarn 금지) |
| UI | Tailwind CSS v4 + 자체 재사용 컴포넌트 |
| 데이터 저장 | 로컬 JSON 파일 (`tickets/*.json`) |
| 실시간 | SSE (Server-Sent Events) |
| Web Push | `web-push` |
| 파일 IO | Node.js `fs/promises` (Route Handlers, `runtime: nodejs`) |

## 컨벤션

- **lint 필수**: 커밋 전에 `pnpm lint` 통과해야 한다. PostToolUse 훅이 `eslint --fix`를 자동 실행한다 (`.claude/settings.json`).
- **재사용 컴포넌트**: shadcn/ui를 쓰지 않고, 자체 프리미티브를 `app/components/ui/`에 둔다 (`Card`, `Badge`, `Button`, `Column` 등). 패널 컴포넌트는 이 프리미티브를 조합해서 만든다. raw Tailwind 유틸리티를 페이지에 직접 길게 쓰지 않는다.
- **App Router 규약**: Route Handler `params`는 Promise. `RouteContext<'/path/[id]'>` 전역 헬퍼 사용. 모든 IO 라우트는 `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- **Server vs Client**: 데이터 페칭과 파일 IO는 서버 컴포넌트/Route Handler에서. 상호작용 컴포넌트만 `"use client"`.
- **타입 우선**: 도메인 타입은 `lib/types.ts`에 모은다. `any` 금지. zod 스키마는 `lib/schemas.ts`에 두고 `satisfies z.ZodType<DomainType>`으로 도메인 타입과 동기화.
- **주석 필수**: 이 프로젝트는 *모든* 공개 함수/타입/프로퍼티에 JSDoc 주석을 단다. 의도·단위·도메인 의미·제약을 적는다. 코드를 그대로 옮기는 주석은 여전히 금지 (`/** ticket id */ id: string` 같은 무의미한 주석은 빈 주석으로 본다). 자세한 가이드는 @docs/rules/comments.md.

## 세부 규칙 (필독)

@docs/rules/api.md
@docs/rules/schemas.md
@docs/rules/components.md
@docs/rules/comments.md
@docs/rules/performance.md
@docs/rules/design.md
@docs/rules/imports.md
@docs/rules/style.md

## 아키텍처 규칙

작업하면서 정리된 규칙. 새 코드를 추가할 때 따른다. 세부 사항은 위 규칙 문서.

### 레이어 책임

| 레이어 | 책임 | 금지 |
|--------|------|------|
| `app/api/**/route.ts` | 입력 파싱(zod) → lib 호출 → 응답 형성 | 비즈니스 로직, 파일 IO 직접 호출 |
| `lib/*-store.ts`, 도메인 lib | 영속화 + 도메인 규칙(상태 머신 등) | HTTP 의존, UI 의존 |
| `lib/web-push.ts` 등 인프라 lib | 외부 시스템 어댑터 | 도메인 데이터 가공 |
| `app/components/ui/**` | 순수 표현 프리미티브 | 도메인 타입 import |
| `app/components/<Panel>.tsx` | 도메인 데이터 + 액션 조합 | raw `fetch`/IO 직접 |
| `app/components/*-client.ts` | 도메인 HTTP 클라이언트 (axios) | UI 렌더 |

### 검증과 신뢰 경계

- zod 검증은 **HTTP 경계에서만** (Route Handler `request.json()`). 내부 함수와 자체 파일(`tickets/*.json`)은 타입을 신뢰한다.
- 잘못된 입력 → `400` + zod `issues`. 도메인 규칙 위반(불법 전이) → `409`. 미존재 → `404`.
- 라우트 핸들러는 lib 에러 메시지를 HTTP 상태로 매핑하는 작은 헬퍼(`errorStatus`)만 둔다.

### 결합 규칙 (단일 시임)

- **Store ↔ Push**: `ticket-store.ts`만 `notifySubscribers`를 import한다. 푸시는 store 외부 누구도 직접 호출하지 않는다.
- **Store ↔ SSE**: `ticketEvents` (in-process EventEmitter)가 유일한 시임. SSE 라우트는 store 내부 함수를 import하지 않는다 (스냅샷용 `listTickets` 외).
- **Frontend ↔ API**: 컴포넌트는 `ticket-client.ts`만 호출한다. raw `fetch`/`axios` 직접 사용 금지.
- **UI ↔ Domain**: `components/ui/*`는 도메인 타입을 모른다. `Badge`는 `variant`만 받고, `OPEN→info` 같은 매핑은 `ticket-meta.ts`에 모은다.

### 응집 규칙

- 한 모듈은 변경 이유 하나. 상태 머신 표(`ALLOWED_TRANSITIONS`)는 모듈 상단 `const`로 한눈에.
- 가드는 헬퍼로 추출 (`assertTransition`, `loadOrThrow`). 인라인 분기 반복 금지.
- 컴포넌트 한 파일 200줄 안. 길어지면 자식 컴포넌트로 분리 (`TicketBoard` → `TicketColumn` → `TicketCard`).

### 데이터 흐름 (클라이언트)

- TanStack Query `["tickets"]` 캐시가 진실의 원천.
- 초기 로드: `useQuery(fetchTickets)`.
- 변경: `useMutation` + `setQueryData`로 캐시 갱신 (refetch 지양).
- 실시간: SSE 이벤트 수신 시 `setQueryData`로 머지. SSE는 refetch 트리거가 아니라 캐시 업데이트 소스.

### 횡단 패턴 (자세한 규칙은 docs/rules)

- **URL이 뷰 상태 진실 원천**: 탭/활성 프로젝트/강조 id는 `useSearchParams`+`router.replace`. localStorage/useState 금지. → `docs/rules/components.md`
- **서버 캐시**: `lib/cache.ts`의 `createCache(name)`만 사용 (메트릭 자동 노출). mtime+size 키 권장. → `docs/rules/performance.md`
- **API 인스트루멘트**: 모든 `/api/*` 라우트는 `withMetrics(routePattern, handler)`로 wrap. → `docs/rules/api.md`
- **세션 식별자**: `?sessionId=` (UUID) 단일 키, `?path=` 금지. → `docs/rules/api.md`
- **SSE 단일 채널**: SSE 라우트는 `/api/sse` 하나뿐. 새 실시간 도메인은 topic envelope로 합치고 별도 라우트 만들지 않는다. 클라이언트는 `subscribeSse(topic)`만 사용. → `docs/rules/api.md` "SSE 단일 채널"
- **알림**: `notify({ category, href, ... })` 둘 다 필수. → `docs/rules/design.md`, `docs/rules/components.md`
- **ETag/304**: 큰 응답은 `<schemaVer>-<mtime+size hash>` ETag로 304. 응답 shape이 바뀌면 schema 버전 bump해 캐시 무효화. → `docs/rules/performance.md`
- **세션 본문 = 메인 + 서브에이전트 합본**: `lib/sessions.ts`의 `readSessionBundle(mainPath)`이 메인 jsonl + `<sessionId>/subagents/agent-*.jsonl`을 묶어 한 본문 + fingerprint로 반환. 모든 파서/뷰는 합본을 가정 (단, line 순서 ≠ 시간순이라 ts로 정렬 필수). 서브에이전트→Agent tool_use_id 매핑은 `buildSubagentParentMap` (promptId+description).
- **용어**: UI 표시는 항상 "서브에이전트". 코드 식별자(필드명·prop)는 Claude Code jsonl 그대로 `isSidechain`/`sidechain` 유지. 신규 UI 문자열에 "사이드체인" 금지.
- **공통 표시 컴포넌트**: 서브에이전트 표시는 `app/components/SidechainBadge.tsx` 단일 진입점 + `Badge` primitive의 `subagent`(violet) variant. raw text/inline 스타일 금지. → `docs/rules/components.md`
- **session-watcher**: 메인 jsonl만 tail (의도). 서브에이전트는 read-time bundling으로 처리해 알림 sessionId가 망가지지 않게 한다.

## 디렉토리 구조

```
claude-workflow-os/
├── instrumentation.ts              # Next.js 부트 훅 (Node 런타임에서 워커 시작)
├── scripts/
│   └── ticket-stop-hook.mjs        # Claude Code Stop hook (자식 세션 종료 시 REVIEW 회수)
├── app/
│   ├── page.tsx                    # 진입 페이지 (대시보드 리다이렉트)
│   ├── dashboard/page.tsx          # 메인 대시보드
│   ├── board/page.tsx              # 티켓 보드
│   ├── monitoring/page.tsx         # Prometheus 자체 차트
│   ├── settings/page.tsx
│   ├── sessions/[id]/page.tsx      # 세션 상세
│   ├── layout.tsx
│   ├── components/
│   │   ├── ui/                     # 재사용 프리미티브 (도메인 모름)
│   │   ├── notifications/          # NotificationProvider, Bell, ToastStack
│   │   ├── chatbot/                # ChatBotWidget + use-chatbot (in-page Claude 챗봇)
│   │   ├── SessionPanel.tsx
│   │   ├── SessionTeamGraphView.tsx # 서브에이전트 팀 그래프
│   │   ├── ContextPanel.tsx
│   │   ├── TicketBoard.tsx
│   │   ├── AcceptanceCriteriaInput.tsx
│   │   ├── BoardHelpModal.tsx
│   │   ├── WorkerLogPanel.tsx      # 티켓 워커 로그 tail
│   │   ├── ServerHealthOverlay.tsx
│   │   ├── sse-bus.ts              # 단일 SSE 연결 multiplex
│   │   ├── use-transition-pulse.ts # 카드 상태 전이 시각 강조
│   │   ├── use-*.ts                # 도메인 훅 (use-tickets, use-sessions, ...)
│   │   └── *-client.ts             # axios 어댑터
│   └── api/
│       ├── context/route.ts
│       ├── tickets/{,[id]}/route.ts
│       ├── tickets/[id]/answer/route.ts        # REVIEW 답변 → 워커 resume
│       ├── tickets/[id]/worker-log/route.ts    # 워커 로그 tail (마지막 32KB)
│       ├── projects/{,[id]}/route.ts
│       ├── sessions/{,info,file,extras,tasks,launch,resume}/route.ts
│       ├── settings/route.ts
│       ├── push/route.ts
│       ├── chat/{route,abort,active,history,sse}/route.ts # 인-페이지 챗봇 백엔드
│       ├── sse/route.ts            # 단일 SSE 엔드포인트 (티켓·세션 태스크 통합)
│       ├── fs/{browse,search}/route.ts
│       ├── entries/route.ts
│       ├── system-check/route.ts
│       ├── health/route.ts         # ServerHealthOverlay polling
│       └── metrics/route.ts        # Prometheus exposition
├── lib/
│   ├── types.ts                    # 공유 도메인 타입
│   ├── schemas.ts                  # zod (HTTP 경계 전용)
│   ├── cache.ts                    # createCache + Prometheus 메트릭
│   ├── metrics.ts                  # prom-client Registry + withMetrics
│   ├── claude-fs.ts                # ~/.claude 컨텍스트 파싱
│   ├── sessions.ts                 # 세션 listing/info
│   ├── session-lookup.ts           # sessionId → path 캐시
│   ├── session-extras.ts           # jsonl 파싱(편집·대화·런타임)
│   ├── session-tasks.ts            # 태스크 라이브 + 리플레이
│   ├── session-watcher.ts          # SSE용 jsonl tail
│   ├── ticket-store.ts             # 티켓 JSON CRUD + 이벤트 버스
│   ├── ticket-worker.ts            # OPEN 픽업 → headless Claude spawn
│   ├── chat-bus.ts                 # 챗봇 turn 스냅샷 + EventEmitter
│   ├── chat-spawn.ts               # `claude -p --output-format stream-json` 어댑터
│   ├── chat-abort.ts               # 진행 중 챗봇 turn 중단 레지스트리
│   ├── project-store.ts            # 프로젝트 등록부
│   ├── app-settings.ts             # 앱 설정 저장
│   ├── web-push.ts                 # VAPID 발송
│   └── ...
├── public/sw.js                    # Service Worker
├── tickets/                        # 티켓 + .projects.json + .logs/<id>.log
├── docs/
│   ├── rules/                      # 아키텍처 규약 (필독)
│   ├── internals/                  # 칸반/세션 jsonl/Trace V2 스펙
│   └── audit/                      # 정기 sweep 보고서 (날짜별)
└── .claude/
    ├── settings.json               # PostToolUse lint-fix 훅
    └── skills/
        ├── work-ticket/SKILL.md    # 자동 워커가 따르는 절차
        └── draft-ticket/SKILL.md   # 한 줄 요청 → 티켓 스펙 자동 생성
```

## 다중 프로젝트

이 도구는 한 화면에서 **여러 프로젝트의 .claude 디렉토리**를 전환해 본다.

- "전체"(id: `ALL`) 탭은 항상 첫 번째이며 삭제 불가. `~/.claude` 글로벌 디렉토리를 가리킨다.
- 사용자 프로젝트는 `tickets/.projects.json`에 저장. 이름 + `claudeRoot` 절대 경로.
- 사용자가 프로젝트 루트(`/Users/me/proj`)를 골라도, 하위에 `.claude`가 있으면 자동으로 `.../proj/.claude`로 보정.
- Context/Session API는 `?project=<id>`로 활성 프로젝트를 식별.

### 세션 매칭

Claude Code는 `~/.claude/projects/<encoded>/` 아래에 `<sessionId>.jsonl`을 기록한다. encoded = 절대 경로의 `/`를 `-`로 치환한 형태.

세션을 프로젝트와 매치할 때는 정확 매칭이 아니라 **prefix 매칭**으로 한다 (사용자가 프로젝트 하위 디렉토리에서 Claude Code를 시작할 수 있으므로).

## 도메인 모델

### 상태 머신

```
OPEN → IN_PROGRESS → REVIEW → DONE
                        ↑         
                        └── (반려)
```

| 상태 | 설명 | Web Push |
|------|------|----------|
| `OPEN` | 미시작 | - |
| `IN_PROGRESS` | 작업 중 | `blocked: true` 시 발송 |
| `REVIEW` | 검토 대기 | 진입 시 발송 |
| `DONE` | 완료 | - |

`CANCELLED`는 어느 상태에서나 단방향 종료.

### Ticket

```ts
type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'REVIEW' | 'DONE' | 'CANCELLED'

type Ticket = {
  id: string
  title: string
  agent?: string
  goal: string
  background?: string
  requirements: string[]
  acceptance_criteria: string[]
  references?: string[]
  priority: 'low' | 'medium' | 'high'
  status: TicketStatus
  blocked: boolean
  blockedReason?: string
  created_at: string
  updated_at: string
}
```

## 워커 (자동 티켓 처리)

`instrumentation.ts`가 Next.js Node 런타임 부팅 시 한 번 `lib/ticket-worker.ts`의 `startTicketWorker()`를 호출한다 (Edge에서는 skip). 워커는

- 부팅 직후 OPEN 티켓을 `maxConcurrentTickets` 한도 안에서 픽업하고,
- `ticketEvents`를 구독해 새 티켓/업데이트가 오면 즉시 추가 픽업한다.
- 픽업한 티켓은 `currentSessionId`(UUID)와 `workerLog` 경로를 채운 뒤 `claude -p --session-id <id>`를 detached + unref로 spawn — 부모 Next 서버와 생명주기를 분리한다. 자식 환경변수 `TICKET_ID`/`CLAUDE_WORKFLOW_OS_URL`을 통해 spawn된 세션이 work-ticket 스킬로 자기 자신을 진행한다.
- 60초 watchdog가 죽은 자식의 inFlight 슬롯을 회수하고, `ticketWatchdogMinutes` 이상 정체된 IN_PROGRESS 티켓을 `pendingApproval=true` + REVIEW로 강제 회수한다.

비정상 종료(exit ≠ 0 또는 signal)는 `pendingQuestion`에 사유를 적고 REVIEW로 보내 사용자가 답변하면 자동 재시도되게 한다.

## 챗봇 (인-페이지 Claude 위젯)

`app/components/chatbot/ChatBotWidget.tsx`가 단일 진입점. 백엔드는 `app/api/chat/*` + `lib/chat-spawn.ts` + `lib/chat-bus.ts` + `lib/chat-abort.ts` 4개 모듈로 구성된다.

- `/api/chat`: `claude -p --output-format stream-json --permission-mode bypassPermissions`을 spawn. stream-json 라인을 파싱해 `chat-bus`에 누적 + emit.
- `/api/chat/sse`: 같은 세션을 보는 다른 탭에 turn 진행 상황을 실시간 푸시 (start/text/tool/end). 신규 구독자에게는 진행 중 turn 스냅샷을 init으로 한 번 보낸다.
- `/api/chat/abort`: `chat-abort` 레지스트리에서 컨트롤러를 찾아 SIGTERM. 사용자가 "중단" 버튼을 누를 때 호출.
- `/api/chat/active`, `/api/chat/history`: 활성 세션 목록과 jsonl 기반 히스토리.

`bypassPermissions`는 인-페이지 챗봇이 사용자 클릭 승인을 거칠 수 없으므로 강제 — 권한 정책상 허용된 작업만 수행한다.

## Stop 훅

`scripts/ticket-stop-hook.mjs`는 워커가 spawn한 자식 Claude 세션의 **모든 턴 종료**에 호출된다 (Claude Code의 Stop hook). 환경변수 `TICKET_ID`/`CLAUDE_WORKFLOW_OS_URL`로 워크플로우 OS에 PATCH해

- 티켓이 여전히 IN_PROGRESS면 `pendingApproval=true` + REVIEW로 회수 → Web Push 발송으로 사용자 인지.
- 스킬이 이미 명시적으로 REVIEW로 전이했다면 noop.

훅 등록은 `lib/ticket-worker.ts`의 `mergeStopHook(cwd)`이 자식 cwd의 `.claude/settings.local.json`에 idempotent하게 머지한다 — 사용자가 직접 손댈 필요 없음.

## 컨텍스트 소스 경로

`projectRoot`는 사용자 글로벌 `~/.claude`. 환경변수 `CLAUDE_PROJECT_ROOT`로 오버라이드.

```
~/.claude/CLAUDE.md
~/.claude/agents/*.md
~/.claude/skills/*.md
~/.claude/settings.json    # Rule(권한/훅) 포함
```

## Web Push

```bash
npx web-push generate-vapid-keys
# .env.local
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:local@localhost
```

발송 트리거:
- `IN_PROGRESS`에서 `blocked` true로 전환될 때
- `REVIEW` 상태로 전환될 때

## 주의

- 인증 없음 (로컬 전용).
- Claude Code 세션 감지는 추후 구체화. 현 단계는 stub.
- 모든 Route Handler는 `runtime: nodejs` (파일 IO 필요).
