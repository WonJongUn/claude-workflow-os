# API Route 규칙

## 구조

Route Handler는 **얇다**. 다음 4단계만 수행한다.

1. 입력 파싱 (zod `safeParse`)
2. 도메인 lib 호출
3. 에러 → 상태 코드 매핑 (`errorStatus` 헬퍼)
4. 응답 형성 (`Response.json`)

비즈니스 로직, 파일 IO, 외부 호출 금지. 전부 `lib/`로 위임한다.

## 파일 컨벤션

```ts
export const runtime = "nodejs";        // 파일 IO/Node API 필요
export const dynamic = "force-dynamic"; // 캐시 금지 (실시간 데이터)
```

`params`는 Promise. `RouteContext<'/api/tickets/[id]'>` 전역 헬퍼 사용 (import 불필요).

## HTTP 상태 매핑

| 상황 | 상태 |
|------|------|
| zod 파싱 실패 | `400` + `{ error, issues }` |
| 도메인 규칙 위반 (불법 상태 전이 등) | `409` |
| 리소스 없음 | `404` |
| 인증 (현 단계 없음) | `401` / `403` |
| 정상 생성 | `201` |
| 정상 조회/수정/삭제 | `200` / `204` |

## PATCH 분기

여러 의도가 한 엔드포인트에 모이면 zod 스키마들에 차례로 `safeParse`해서 분기한다. 수동 type guard 금지.

```ts
const t = TransitionBodySchema.safeParse(body);
if (t.success) return ...;
const b = BlockedBodySchema.safeParse(body);
if (b.success) return ...;
const u = TicketUpdateSchema.safeParse(body);
if (u.success) return ...;
return Response.json({ error: "Invalid body" }, { status: 400 });
```

## 에러 매핑 헬퍼

라우트마다 작은 `errorStatus(err)` 헬퍼를 두거나 공통 모듈에 둔다. 메시지 문자열 매칭이 아닌 **에러 클래스 식별**을 우선 (`TicketNotFoundError`, `IllegalTransitionError`).

## 인스트루멘테이션

모든 `/api/*` 라우트는 `withMetrics(route, handler)`로 감싼다. `lib/metrics.ts`에서 `http_requests_total`, `http_request_duration_seconds`(Histogram)를 자동 기록한다.

```ts
async function _GET(request: NextRequest) { ... }
export const GET = withMetrics("/api/sessions/:id", _GET);
```

route 인자는 동적 세그먼트를 `:id`로 정규화한 패턴 — 라벨 카디널리티 폭주 방지. 새 라우트를 추가하면 wrapper 적용을 잊지 말 것.

`/api/health`, `/api/metrics`, SSE 라우트는 의도적으로 제외(자기 호출 루프/스트리밍 측정 무의미).

## 세션 식별자

세션 API의 입력은 항상 **세션 id (UUID)**. `?path=` 같은 절대 경로 입력은 받지 않는다 — 보안 표면을 줄이고, URL이 깔끔해지며, 서버가 단일 lookup helper(`findSessionPathById`)로 캐시 효과를 누리기 때문.

## 서브에이전트 본문 통합

`/api/sessions/file`, `/api/sessions/extras`, `/api/sessions/tasks` 등 세션 본문을 다루는 라우트는 메인 jsonl과 `<sessionId>/subagents/agent-*.jsonl`을 합쳐 처리한다 (`readSessionBundle`). 서브에이전트 nesting을 위해 `/api/sessions/file`은 응답에 `subagentParents: Record<agentId, parentToolUseId>` 매핑을 포함 — 클라이언트(Trace V2)가 부모 Agent를 직접 lookup. 매핑은 promptId(jsonl 필드) + meta.json description으로 확정한다.

## ETag/캐시 버스팅

세션 본문 응답의 ETag는 `"<schemaVersion>-<contentHash>"`. **응답 JSON shape이 바뀌면 schemaVersion을 bump**해 브라우저가 보유한 옛 etag와 mismatch → 서버가 새 본문 + 새 etag 응답. 그렇지 않으면 클라가 캐시된 옛 본문을 무한정 재사용해 신규 필드를 못 받는다.

## 백그라운드 spawn 라우트 (chat / ticket-worker)

외부 프로세스(`claude -p`)를 spawn하는 라우트는 다음 패턴을 따른다.

- `lib/chat-spawn.ts`/`lib/ticket-worker.ts`처럼 spawn 자체는 lib에 둔다 — 라우트는 옵션 파싱 + lib 호출만.
- 부모(Next 서버) 생명주기와 분리해야 하면 `detached: true` + `child.unref()`. ticket-worker가 그 케이스.
- 사용자가 도중에 끊을 수 있는 흐름(인-페이지 챗봇)은 `AbortController` 레지스트리(`lib/chat-abort.ts`) + 전용 abort 라우트로. AbortSignal은 spawn 함수에 인자로 흘려보내 SIGTERM 변환.
- 진행 상황 fan-out은 in-process EventEmitter(`lib/chat-bus.ts`). 다른 탭/구독자는 SSE 라우트로 join하고, 신규 구독자에게는 현 turn 스냅샷을 init으로 1회 보낸다 (재구독해도 화면이 비지 않게).

## SSE 단일 채널

브라우저 HTTP/1.1는 origin당 6 connection이 한도다. 영구 점유되는 SSE 라우트가 2개면 슬롯이 둘 잠식되고 짧은 fetch가 큐에 밀린다 (페이지 로딩 지연). 그래서 **이 앱의 SSE 라우트는 `/api/sse` 단 하나**.

규칙:

- 새 도메인 이벤트(티켓·세션 태스크·챗봇·기타)는 모두 `/api/sse`에 topic envelope `{topic: "<domain>", ...payload}`로 합친다.
- 별도의 `/api/<domain>/sse` 라우트를 만들지 않는다. 새로 추가하기 전에 기존 `/api/sse` 핸들러에 in-process EventEmitter 구독을 더하는 방식으로 합칠 것.
- 도메인 lib는 `globalThis`에 hoist된 EventEmitter(`ticketEvents`, `chat-bus`, `sessionTaskEvents` 등)에 emit. `/api/sse`가 그 emitter들을 fan-out.
- 클라이언트는 `app/components/sse-bus.ts`의 `subscribeSse(topic, handler)`로만 SSE를 다룬다. 직접 `new EventSource(...)` 금지.
- 기존 SSE 통합이 잘 되어 있는 예시: `app/api/sse/route.ts`가 `ticketEvents` + `sessionTaskEvents` + 챗봇 글로벌 채널을 동시 fan-out.

## 금지

- `try/catch`로 도메인 에러를 삼키고 200 반환하는 패턴
- 라우트 안에서 `fs.readFile` 직접 호출
- `any` 캐스트로 zod 우회
- 응답에 도메인 내부 객체 그대로 반환 (필요하면 라우트에서 정제)
- **`/api/sse` 외의 SSE 라우트 추가** — 위 "SSE 단일 채널" 참조.
- **클라이언트가 `new EventSource(...)`를 직접 호출** — `subscribeSse` 사용.
