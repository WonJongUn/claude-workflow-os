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

## 금지

- `try/catch`로 도메인 에러를 삼키고 200 반환하는 패턴
- 라우트 안에서 `fs.readFile` 직접 호출
- `any` 캐스트로 zod 우회
- 응답에 도메인 내부 객체 그대로 반환 (필요하면 라우트에서 정제)
