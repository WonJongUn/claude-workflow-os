# 컴포넌트 규칙

## 계층

```
app/components/ui/*       # 순수 프리미티브 (도메인 모름)
app/components/<Panel>    # 도메인 컴포넌트 (프리미티브 조합)
app/components/*-client.ts # HTTP 어댑터 (axios)
app/components/*-meta.ts   # 도메인 → UI 매핑 테이블
```

## 프리미티브 (`components/ui/`)

- **도메인 타입 import 금지**. `Ticket`, `ClaudeContext` 등을 알면 안 된다.
- variant/size 같은 표현 props만 받는다.
- 클래스 합성은 `cn()` 유틸 사용. `clsx` 의존성 추가 금지.
- 한 파일 한 컴포넌트 (Card 계열은 `Card.tsx` 안에 `CardHeader`/`CardBody` 같이 둠).

## 도메인 컴포넌트

- 200줄 넘으면 자식으로 쪼갠다 (`Board → Column → Card → Actions`).
- HTTP는 `*-client.ts`만 호출. 컴포넌트에서 `axios`/`fetch` 직접 사용 금지.
- 도메인 enum → variant 매핑은 `*-meta.ts`의 `const` 객체로 (인라인 ternary 금지).
- "use client"는 상호작용/훅이 진짜 필요할 때만. 기본은 Server Component.

## Props

- 모든 public Props 인터페이스 프로퍼티에 JSDoc 주석 필수.

```ts
type TicketCardProps = {
  /** 표시할 티켓. 부모 캐시에서 내려준다. */
  ticket: Ticket;
  /** 액션 버튼 클릭 시 호출. 낙관적 업데이트는 호출자 책임. */
  onAction: (action: TicketAction) => void;
};
```

## React Query는 도메인 훅 뒤에 숨긴다

컴포넌트는 `useQuery`/`useMutation`/`useQueryClient`를 직접 import하지 않는다. 도메인 훅으로 래핑한다.

```ts
// 좋음 — 컴포넌트 입장에서 react-query/SSE/HTTP 모두 invisible
const { tickets } = useTickets();
const { transition } = useTicketTransition();

// 나쁨 — 캐시 키, 쿼리 함수, 캐시 갱신 로직이 컴포넌트로 누수
const { data } = useQuery({ queryKey: ["tickets"], queryFn: fetchTickets });
const queryClient = useQueryClient();
```

훅 작성 규칙:
- 한 도메인에 한 모듈 (`use-tickets.ts`).
- 캐시 키, SSE 구독, fetch 함수는 모듈 내부에 갇힌다 — export 금지.
- 훅이 반환하는 객체는 컴포넌트가 필요한 최소 인터페이스 (`{ tickets, isLoading }`, `{ create, isPending }`).
- mutation의 `onSuccess`/`onError`는 호출자가 콜백으로 받는다 (`create(input, { onSuccess, onError })`).
- 변경은 `setQueryData`로 즉시 반영. 무지성 `invalidateQueries` 금지.
- SSE 이벤트도 `setQueryData`로 머지. refetch 트리거가 아니다.
- mutation 도메인 훅은 성공/실패 시 `useNotify`로 토스트를 발송한다. 컴포넌트가 알림을 직접 띄우지 않는다.
- `notify({ category, href, ... })`에 카테고리(`task`/`session`/`ticket`/`project`/`settings`/`system`)와 클릭 시 이동 경로를 반드시 부여한다 — 알림 센터 탭 필터링과 라우팅이 그것에 의존.

## URL이 단일 진실 원천 (Source of Truth)

뷰 상태(현재 탭, 활성 프로젝트, 강조 태스크 등)는 URL 쿼리/세그먼트에서 파생한다. `useSearchParams`로 읽고, `router.replace`로 갱신.

이유:
- 알림/외부 링크에서 들어와도 같은 화면을 재현 가능
- 뒤로가기/북마크/공유가 자연스럽게 동작
- 컴포넌트별 `useState`와 URL이 어긋나지 않음 (sync effect 불필요)

쓰기 규칙:
- 탭 클릭 같은 빈번한 갱신은 `router.replace`로 history 안 쌓이게.
- 의미가 끝난 쿼리(`taskId`는 tasks 탭에서만 유효)는 다른 상태로 이동할 때 함께 정리.
- 기본값(`tab=conversation`, `project=ALL`)은 쿼리 자체를 빼서 URL을 짧게.

## 외부 시스템 경로 안전

서버 라우트가 사용자 입력 경로로 파일을 읽을 때는 base 디렉토리를 강제한다.

```ts
const abs = path.resolve(input);
if (!abs.startsWith(`${BASE}${path.sep}`)) {
  return Response.json({ error: "path not allowed" }, { status: 403 });
}
```

## 큰 파일

세션 jsonl처럼 무한히 자랄 수 있는 파일은 마지막 N바이트만 읽는다 (`MAX_BYTES`).
잘렸으면 `truncated: true`를 반환하고 UI에서 표시. 부분 읽기로 잘린 첫 줄은 버린다.

## Tailwind

- v4. `@apply` 금지, 클래스 직접.
- 색은 zinc/slate 스케일로 통일. 다크모드 `dark:` variant 필수.
- 길이 50자 넘는 className은 `cn()`으로 줄을 나누거나 프리미티브로 추출.

## 금지

- 프리미티브에 도메인 분기
- 컴포넌트 안 raw `fetch`
- `any` props
- 한 파일에 5개 이상 컴포넌트

## 챗봇 위젯

인-페이지 Claude 챗봇은 `app/components/chatbot/ChatBotWidget.tsx` 단일 진입점만 사용한다. 내부 상태/SSE 구독은 `use-chatbot.ts` 훅에 캡슐화되어 있고, 메시지 리스트는 `ChatMessageList.tsx`로 분리. 다른 페이지가 챗봇을 띄우고 싶을 때 위젯을 별도로 다시 구현하지 말고 위 컴포넌트를 mount한다.

## 툴팁 — 네이티브 `title` 금지

호버로 보조 설명을 띄울 때는 항상 `app/components/ui/Tooltip.tsx`를 사용한다. HTML 네이티브 `title` 속성을 *정보성 툴팁* 용도로 쓰지 않는다.

기본 위치는 트리거 위(top), 위 공간이 부족하면 자동으로 아래(bottom)로 flip된다 — 페이지 상단의 트리거에서도 잘리지 않는다. 호출자는 위치를 신경 쓰지 않는다.

이유:

- 네이티브 `title`은 OS가 ~500ms 이상 늦게 띄우고, 일부 환경(예: 일부 터미널 내 웹뷰, 모바일 사파리)에서는 아예 뜨지 않는다.
- 폰트·테마·다크모드·줄바꿈 모두 OS가 결정 → 디자인 시스템과 어긋난다.
- 자식 요소에 `cursor: help`만 보이고 본문이 안 떠 사용자가 "왜 ?만 나오지?" 하게 만든다.

### 옳음

```tsx
import { Tooltip } from "@/app/components/ui";

<Tooltip content="사용자가 입력한 메시지(턴 시작점).">
  <Badge variant="default">사용자</Badge>
</Tooltip>
```

### 나쁨

```tsx
<Badge variant="default" title="사용자가 입력한 메시지">사용자</Badge>
//                       ^^^^^ OS가 ~500ms 후에 띄움. 금지.

<span className="cursor-help" title="…">…</span>
//                              ^^^^^ 같은 이유로 금지.
```

### 예외 — 허용되는 native `title`

다음 경우는 native `title`을 그대로 두어도 된다:

- **`Modal`/`Card` 등 컴포넌트의 `title` *prop*** — HTML 속성이 아니라 컴포넌트 인터페이스다.
- **`overflow: hidden; text-overflow: ellipsis`로 잘린 텍스트의 fallback** — `<span className="truncate" title={fullText}>`. 사용자가 잘린 부분을 정확히 보고 싶을 때 OS 동작이 자연스럽다 (Tooltip은 매 행에 portal을 만들어 비용 ↑).
- **아이콘만 있는 버튼의 `aria-label`과 함께** — 일부 스크린리더가 `title`을 picks up. 단, 정보성 본문이 길면 Tooltip을 추가로 감싼다.

### 공통 라벨/설명 표

뱃지·아이콘 종류별 라벨·툴팁 문구는 **한 곳에서만** 정의한다 (`app/components/session-log-shared.ts`의 `KIND_LABEL`, `KIND_TOOLTIP`, `SPAN_KIND_TOOLTIP` 처럼). 새 뷰가 같은 종류의 뱃지를 그릴 때 그 표를 import해 의미가 갈라지지 않게 한다.

서브에이전트(사이드체인) 표시는 `app/components/SidechainBadge.tsx` 컴포넌트를 import해서만 사용한다 — Tooltip + `Badge variant="subagent"`(violet) + `whitespace-nowrap`이 한 묶음. raw `<span>`/inline 스타일/다른 variant 금지. UI 문자열은 항상 "서브에이전트", 코드 식별자(`isSidechain`/`sidechain`)는 Claude Code jsonl 필드 그대로 유지.

Badge variant 표:

| variant | 톤 | 용도 |
|---|---|---|
| `default` | zinc | 중립 라벨 |
| `success` | emerald | 완료/성공 |
| `warning` | amber | 주의/대기 (`결과` 등) |
| `danger` | red | 에러/실패 |
| `info` | sky | 정보/사용자 |
| `subagent` | violet | 서브에이전트 전용. amber와 충돌하지 않도록 별도 톤. |

### 검토 체크리스트

PR 리뷰 시:

- [ ] 새로 추가된 호버 설명은 `Tooltip`으로 감싸졌는가?
- [ ] `title="…"` 속성이 정보성 용도로 남아있지 않은가?
- [ ] 뱃지·아이콘 종류별 문구가 새로 흩어지지 않고 공통 표를 import 했는가?
