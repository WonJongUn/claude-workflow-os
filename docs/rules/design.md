# 디자인 시스템 규칙

UI 일관성을 위해 다음 토큰만 사용한다. 새 색/폭/모서리 값을 추가하기 전에 기존 토큰으로 표현 가능한지 먼저 확인한다.

## 색상

zinc/slate 스케일을 기본으로 한다. 의미 색은 다음만 허용.

| 의도 | Light | Dark |
|------|-------|------|
| 배경 | `bg-zinc-50` | `dark:bg-zinc-950` |
| 표면(카드) | `bg-white` | `dark:bg-zinc-950` |
| 보조 표면 | `bg-zinc-100` | `dark:bg-zinc-900` |
| 본문 텍스트 | `text-zinc-900` | `dark:text-zinc-100` |
| 보조 텍스트 | `text-zinc-600` / `text-zinc-500` | `dark:text-zinc-400` |
| 테두리 | `border-zinc-200` | `dark:border-zinc-800` |
| primary 액션 | `bg-zinc-900 text-white` | `dark:bg-zinc-100 dark:text-zinc-900` |
| danger | `text-red-600 bg-red-50 border-red-200` | `dark:text-red-300 dark:bg-red-950 dark:border-red-900` |
| success | `text-emerald-600` | `dark:text-emerald-300` |
| warning | `text-amber-600` | `dark:text-amber-300` |
| info | `text-sky-600` | `dark:text-sky-300` |
| 서브에이전트 | `text-violet-600 bg-violet-50 border-violet-200` | `dark:text-violet-300 dark:bg-violet-950 dark:border-violet-900` |

`Badge`의 `variant`가 이 의미 매핑의 단일 소스. 컴포넌트에서 의미 색을 직접 칠하지 말고 `<Badge variant="...">` 또는 프리미티브 사용.

## 모서리/그림자

- 작은 칩/입력: `rounded-md`
- 카드/패널: `rounded-lg`
- 모달: `rounded-xl`
- 그림자: `shadow-sm` (카드), `shadow-2xl` (모달). 그 외 사용 금지.

## 간격

Tailwind 기본 스케일만. 자주 쓰는 값:

- 아이템 간격: `gap-1`, `gap-2`, `gap-3`
- 섹션 간격: `gap-4`, `gap-6`
- 패딩: `p-3` (카드 본문), `px-3 py-2` (버튼/뱃지), `p-5` (모달)

임의값(`p-[7px]`)은 마지막 수단.

## 타이포그래피

- 제목 H1: `text-2xl font-semibold tracking-tight`
- 카드 제목: `text-base font-semibold`
- 본문: 기본 (`text-sm`)
- 보조: `text-xs text-zinc-500`
- 모노스페이스 라벨/ID: `font-mono text-[10px]` 또는 `text-xs`

## 상태 표현

- 활성 탭/메뉴: 진한 zinc-900 배경 + 흰 글자 (다크: 반전)
- 호버: `hover:bg-zinc-100` (다크 `dark:hover:bg-zinc-900`)
- 비활성: 텍스트 zinc-500 또는 zinc-400, 마우스 커서 not-allowed

## 폼

- 입력은 `inputBaseClass` (Field 모듈) 그대로 사용. 변형 필요하면 prop을 Field에 추가하지 말고 별도 primitive 만들기.
- 라벨은 항상 `<Field label>` 사용. `<label>` 직접 작성 금지.
- 필수 표시: `*` (red-500). placeholder는 예시값만.

## 다크 모드

모든 색 클래스는 `dark:` 짝을 함께 작성. 한쪽만 있는 색 금지.

## 아이콘 / 이모지

라이브러리 의존성을 줄이기 위해 유니코드 글리프와 이모지를 사용한다. 아래 표에 없는 아이콘을 추가하기 전에 기존 것으로 표현 가능한지 먼저 확인.

| 의도 | 글리프 | 사용 예 |
|------|--------|---------|
| 신규 작성 (큰 의미) | 📝 | "새 티켓" |
| 폴더/프로젝트 | 📁 | "프로젝트 추가", "폴더 선택" |
| 작은 추가 (인라인) | `＋` (full-width) | "추가" 버튼 |
| 수정 | `✎` | 인라인 편집 |
| 삭제/닫기 | `✕` | 모달 닫기, 항목 삭제 |
| 상위 디렉토리 | `↑` | 디렉토리 브라우저 |
| 펼침/접힘 | `»` / `«` | 사이드바 |
| 진행 화살표 | `→` | "보기 →" |
| 트리 구분 | `▸` | 디렉토리 행 |

규칙:

- 이모지(컬러)는 **최상위 액션** 한두 개에만 (예: 새 티켓, 프로젝트 추가). 나머지는 모노톤 글리프.
- 항상 `aria-hidden`으로 감싸고, 의미는 인접 텍스트가 전달.
- 텍스트가 없는 아이콘 버튼은 `aria-label` 필수. 보조 설명이 더 필요하면 `Tooltip` primitive 사용 — native `title` 정보성 사용은 components.md "툴팁" 규칙대로 금지(스크린리더 fallback 예외만 허용).
- `text-base`/`text-sm` 등 부모 폰트 사이즈를 따르도록. 별도 크기 지정 금지.

## 스크롤 영역

스크롤이 발생하는 모든 요소에 `scroll-thin` 클래스를 붙인다 (`globals.css` 정의).

- 콘텐츠와 스크롤바 겹침 방지: `scrollbar-gutter: stable`로 거터 공간을 항상 예약.
- 얇은 스크롤바: webkit `8px` + `scrollbar-width: thin`.
- 적용 대상: 세션 리스트, 컨텍스트/세션 모달의 `<pre>`, 디렉토리 브라우저, @ 자동완성 드롭다운, 알림 패널 등 `overflow-y-auto`가 있는 모든 곳.

리스트는 부모 카드 패딩과 **너비를 일치**시킨다.

```tsx
<CardBody className="p-0">           // 카드 본문 패딩 제거
  <ul className="scroll-thin divide-y …">  // 분할선만, 항목별 border 금지
    <li className="px-4 py-3 …" />          // 카드 내부 패딩은 항목이 부담
  </ul>
</CardBody>
```

리스트 항목에 둘레 border + 카드 안쪽 padding을 함께 쓰면 너비가 어긋나 보인다. divide-y만 사용하고 hover bg로 경계를 표현.

## 갱신·로딩 표시

### Refresh 버튼

`<RefreshButton onClick={refetch} isFetching={isFetching} />`. 다음 두 가지를 보장한다.

- 외부 fetch가 너무 빨라서 사용자가 시각 피드백을 못 받지 않도록 **최소 600ms** 회전 보장 (`MIN_SPIN_MS`).
- 외부 `isFetching` 신호가 길어지면 그 동안 회전 유지.

### 폴링 간격

준실시간이 필요한 데이터는 5초 폴링 + 탭 포커스 시 즉시 갱신.

```ts
useQuery({
  queryKey: [...],
  queryFn: ...,
  refetchInterval: 5_000,
  refetchIntervalInBackground: false, // 백그라운드 탭에선 멈춤 (트래픽 절약)
  refetchOnWindowFocus: true,
  staleTime: 0,
});
```

세션·컨텍스트가 이 패턴을 따른다. 실시간성이 더 필요한 데이터(티켓)는 SSE로 push.

## 폼 미리보기

폼이 마크다운/구조화된 결과물을 만든다면 같은 모달 안에서 **모드 전환** (`'edit' | 'preview'`).
모달 위에 모달을 겹치지 않는다 — 사용자에게 직관적이지 못하다.

- 편집 모드: 우측 하단(저장 버튼 옆)에 "미리보기" 버튼.
- 미리보기 모드: 상단에 "← 폼으로 돌아가기" + 미리보기 안내 문구.
- 저장은 편집 모드에서만 가능.

## 모달 닫기 동선

`Modal` 컴포넌트는 ESC와 백드롭 클릭으로 닫힌다. 추가 X 버튼은 우측 상단에 항상 둔다.
파괴적 작업(삭제 등)은 `ConfirmDialog`로 한 번 더 확인.

## 알림 패턴

- mutation 성공/실패는 자동으로 토스트로 알린다 (도메인 훅이 `useNotify` 호출).
- 우측 상단 종 아이콘 + 패널: `NotificationBell`. 히스토리는 localStorage에 보존.
- 토스트는 4.5초 자동 dismiss + 수동 닫기.
- 트리거 위치는 컴포넌트가 아닌 도메인 훅 (`useCreateProject`, `useSaveEntry` 등) — 호출자에 코드 없이 일관된 알림.
- `notify({ category, href, ... })`에 카테고리(`task`/`session`/`ticket`/`project`/`settings`/`system`)와 클릭 시 이동 경로를 반드시 부여한다. 패널에서 카테고리 탭으로 필터링하고 클릭으로 라우팅된다.
- 카테고리 탭은 항상 모두 표시(0건도 흐리게), 정렬은 개수 내림차순이며 "전체"가 첫 번째.

## 서브에이전트 표시

서브에이전트(Claude Code의 Task/Agent 도구로 spawn된 보조 에이전트)는 모든 뷰에서 동일한 시각 언어로 구분한다.

- 색: violet (좌측 가이드 + 뱃지). 다른 의미 색(amber/sky/red 등)과 충돌 안 하도록 별도 톤.
- 라벨: 항상 **"서브에이전트"**. "사이드체인" 등 영문/기술 용어 금지 (코드 식별자 `isSidechain`/`sidechain`은 jsonl 필드라 유지).
- 사용 컴포넌트: `app/components/SidechainBadge.tsx` (Tooltip + `Badge variant="subagent"` + nowrap) 단일 진입점.
- 적용 대상: Timeline 행, 대화 turn, 편집 파일 행, Trace V1/V2 라벨, SwimLane 레인. 새 뷰가 추가되면 같은 패턴 따른다.

## 절대 위치 / 차트 축 라벨

`absolute` + `translate(-50%, -50%)`는 **0% 또는 100% 위치에서 부모를 빠져나간다.** 차트 축 라벨, 배지 위치 등에 자주 쓰이며 이전 라운드에서 반복적으로 깨진 부분.

### 양 끝 anchor 분기

축 라벨, 끝점 표시 등을 그릴 때 0%/100%/중간을 분기한다:

```tsx
// y축 (수직): 최상단·최하단은 부모 안쪽으로 anchor.
const positional: React.CSSProperties =
  i === ticks.length - 1
    ? { top: 0 }
    : i === 0
      ? { bottom: 0 }
      : { bottom: `${pct}%`, transform: "translateY(50%)" };

// x축 (수평): 시작·끝은 부모 안쪽으로 anchor.
const positional: React.CSSProperties =
  i === 0
    ? { left: 0 }
    : i === last
      ? { right: 0 }
      : { left: `${pct}%`, transform: "translateX(-50%)" };
```

### 차트 영역 분리

- y축 라벨은 **차트 영역과 분리된 컬럼**으로 둔다 (예: `w-8 shrink-0`). 라벨이 막대를 침범하지 않는다.
- x축 라벨 컨테이너는 차트와 같은 너비(같은 좌측 마진)로 두어 정렬을 맞춘다.
- 그리드 라인은 `inset-x-1` 등 padding 안쪽에만 그려, padding 영역에 라인이 튀어나오지 않게.
- `whitespace-nowrap` + `font-mono`로 라벨 폭을 예측 가능하게.

### Nice ceil

차트 max는 raw 값이 아니라 1·2·5·10 배수로 올림 (`niceCeil`). 그래야 tick 간격이 균등하고 라벨이 가독성 있는 정수가 된다.

## 동적 텍스트 옆에 회전 애니메이션 금지

회전·맥동하는 아이콘과 같은 줄에 텍스트를 두면 **텍스트가 좌우로 흔들린다.** 새로고침 아이콘과 갱신 시각이 대표적.

해결: `flex-col items-end leading-tight`로 **세로 스택**, 아이콘이 위·텍스트가 아래.
인라인이 필요하면 아이콘을 별도 박스(`shrink-0 w-…`)로 격리해서 회전이 옆 텍스트를 밀지 않게 한다.

## 카드 헤더 좌·우 두 줄 스택

헤더의 한쪽이 두 줄(아이콘 + 보조 텍스트)이고 반대쪽이 한 줄이면 `items-start`로 상단 정렬하고 한 줄 쪽도 보조 텍스트를 두어 시각적으로 균형을 맞춘다.

```tsx
<CardHeader className="items-start">
  <div className="min-w-0 flex-1">
    <CardTitle>제목</CardTitle>
    <div className="mt-0.5 text-[11px] text-zinc-500">{보조정보}</div>
  </div>
  <RefreshControl ... />
</CardHeader>
```

`items-center`로 두면 두 줄 쪽이 한 줄 쪽을 위아래로 늘려 헤더 전체가 부풀어 보인다.

## absolute 푸터·배지의 부모 침범

`position: absolute`로 카드 헤더 안에서 그 아래 영역(카드 본문)으로 텍스트를 띄우면 본문을 가린다. 갱신 시각·툴팁 등은 **인라인 스택**으로 두거나 `top-full mt-…`만 쓸 게 아니라 부모 높이도 함께 늘려준다.

## 엣지 케이스 사전 점검

새 컴포넌트를 추가할 때 다음 4가지를 머릿속으로 그려본다:

1. **빈 데이터** — 0건일 때도 시각적으로 깨지지 않는가?
2. **양 끝 값** — pct=0 / pct=100, 첫 항목 / 마지막 항목 위치에서 부모를 빠져나가지 않는가?
3. **긴 텍스트** — 라벨이 길어지면 잘리거나 줄바꿈되어 옆 컴포넌트를 침범하지 않는가? (`truncate`, `whitespace-nowrap` 적절히)
4. **상태 전이 애니메이션** — 회전·확대·페이드 시 옆 요소가 흔들리지 않는가?

리뷰 시 이 4개 항목을 확인하지 않고 머지하지 않는다.

## 버튼

기본 액션 버튼은 `app/components/ui/Button.tsx`만 사용. 인라인 `<button>`은 표 셀 액션·아이콘 토글처럼 표현이 다른 경우에만.

### 라벨

- **아이콘 + 텍스트**가 기본. 라벨이 명확해도 아이콘은 의미 강화·시각 스캔에 도움.
- 한 단어 액션은 텍스트만으로 부족. 아이콘으로 동사를 한눈에 보여준다.
- Button primitive에 `gap-1.5`가 자동 적용되므로 `<Icon /> <span>라벨</span>` 두 자식만 두면 된다.

### 표준 매핑

| 의도 | 아이콘 | 라벨 예 |
|------|--------|--------|
| 저장 | `Save` | "저장" |
| 취소/닫기 | `X` | "취소" |
| 추가 (큰) | `Plus`, `FolderPlus`, `FilePlus2` | "추가", "프로젝트 추가", "티켓 생성" |
| 삭제 | `Trash2` | "삭제" |
| 편집 | `Pencil` | "편집" |
| 미리보기 | `Eye` | "미리보기" |
| 이전 | `ArrowLeft` | "← 폼으로 돌아가기" |
| 폴더 선택 | `FolderOpen` | "폴더 찾아보기" |
| 새로고침 | `RefreshCw` | (아이콘만, RefreshButton) |

새 의도가 생기면 위 표에 추가하고 일관되게 사용. lucide-react 외 아이콘 라이브러리 추가 금지.

### 변형

- `primary` (기본): `bg-zinc-900 text-white` / dark 반전. 폼의 단일 제출, 모달의 주요 CTA.
- `ghost`: 테두리 + 투명 배경. 보조 액션 (취소, 폴더 찾아보기, 미리보기 등).
- `danger`: 강조된 빨강 (`bg-red-600 text-white`). 파괴적 confirm. ConfirmDialog `variant="danger"`.

같은 줄에 두 버튼이면 **왼쪽 ghost (취소) + 오른쪽 primary/danger**. `justify-end`.

### 인라인 미니 버튼

행 안의 작은 토글/액션은 Button primitive 대신 `inline-flex h-6 w-6 / h-7 ... rounded-md border` 패턴. 이 경우에도 색은 design.md 의미 색만 사용 (red-200/red-50/red-600 류).

## 로딩과 깜빡임

서버 데이터로 폼 초기값을 채우는 화면은 **fetch 중 폼을 렌더하지 않는다.** 대신 같은 영역 크기의 회색 자리표시자(skeleton)를 보여주고, 데이터가 도착한 뒤에 폼을 마운트한다.

- 잘못된 패턴: `useState(initial)` + `useEffect`로 사후 동기화 → 첫 프레임에 잘못된 값이 보였다가 바뀌어 깜빡임.
- 옳은 패턴: 부모에서 `isLoading ? <Skeleton/> : <Form initial={data} />`. 자식 mount 시점에 정확한 초기값.

이 규칙은 라우트 페이지뿐 아니라 모달 폼에도 적용.

## 설정 페이지 레이아웃

설정/관리 페이지는 카드 안에 카드를 두지 않는다. 페이지 자체가 컨테이너 — 섹션을 `border-t` divider로 구분.

```
[페이지 헤더]
[섹션 1: 좌측 14rem 제목/설명 | 우측 입력 필드들]
─── divider ───
[섹션 2: 동일 패턴]
─── divider ───
[저장 버튼 우측 정렬]
```

좌·우 두 컬럼 (`grid-cols-1 md:grid-cols-[14rem_1fr]`). 설명이 짧을 때는 좌측 컬럼이 잉여 공간을 차지하지만, 시야 정렬이 일관돼서 가독성이 더 큼.

## 알림 순서

토스트 스택은 **최신이 맨 위**. 새 알림이 위에서 등장하고, 아래로 밀리면서 자동 dismiss. `setToasts(prev => [note, ...prev])`. 히스토리도 동일.

## 검토 체크리스트

PR 리뷰 시 확인:

- [ ] 새 색 hex/임의값 없음
- [ ] `dark:` 짝 누락 없음
- [ ] 의미 색은 `Badge` 또는 명시적 의미 클래스 (red/emerald 등)로만 사용
- [ ] 모서리/그림자가 위 표 안에 있음
- [ ] 라벨은 `Field` 사용
- [ ] 스크롤 영역에 `scroll-thin` 적용
- [ ] absolute 라벨이 0%/100%에서 부모를 벗어나지 않게 anchor 분기
- [ ] 차트 축 라벨 컨테이너가 차트와 정렬되어 막대를 침범하지 않음
- [ ] 회전 아이콘 옆에 텍스트를 인라인으로 두지 않음 (세로 스택)
- [ ] 헤더 좌우 두 줄 스택이면 `items-start`
- [ ] 빈 데이터 / 단일 항목 / 매우 긴 텍스트 케이스 점검
