# 코딩 스타일 규칙

## Early Return (가드 절) 장려

조건 분기에서 행복 경로(happy path)는 함수 본문 가장 바깥에 두고, 실패/예외 케이스는 가능한 빨리 반환한다. 들여쓰기 깊이가 한 단계 줄고, 가드와 본문이 시각적으로 분리되어 흐름이 한눈에 들어온다.

### 좋음

```ts
function transitionTicket(t: Ticket, next: TicketStatus): Ticket {
  if (t.status === "DONE") throw new IllegalTransitionError();
  if (t.status === next) return t;
  if (!isAllowed(t.status, next)) throw new IllegalTransitionError();

  return { ...t, status: next, updated_at: now() };
}
```

### 나쁨

```ts
function transitionTicket(t: Ticket, next: TicketStatus): Ticket {
  if (t.status !== "DONE") {
    if (t.status !== next) {
      if (isAllowed(t.status, next)) {
        return { ...t, status: next, updated_at: now() };
      } else {
        throw new IllegalTransitionError();
      }
    } else {
      return t;
    }
  } else {
    throw new IllegalTransitionError();
  }
}
```

## 적용 가이드

- **검증 → 본문 순서**: 입력/상태 검증을 먼저 하고 가드로 빠져나간 뒤, 본문은 "정상 케이스"만 다룬다.
- **else 블록 회피**: `if (...) return ...; else { ... }` 보다 `if (...) return ...;` 후 평탄한 본문.
- **null/undefined 체크 먼저**: 옵셔널 인자/리소스 미존재는 함수 진입 직후 처리.
- **삼중 중첩 이상은 리팩터링 신호**: 보통 가드 추출 또는 작은 함수 분리로 해결된다.
- **루프 안에서도 적용**: `continue`/`return`을 사용해 본문 들여쓰기를 줄인다.

```ts
// 좋음
for (const item of items) {
  if (!item.active) continue;
  if (item.size === 0) continue;
  process(item);
}

// 나쁨
for (const item of items) {
  if (item.active) {
    if (item.size > 0) {
      process(item);
    }
  }
}
```

## React 컴포넌트

- 조기 분기로 렌더 본문을 평탄하게:

```tsx
// 좋음
if (!session) return null;
if (isLoading) return <Skeleton />;
return <SessionDetail session={session} />;

// 나쁨
return session ? (isLoading ? <Skeleton /> : <SessionDetail session={session} />) : null;
```

- 깊은 삼항 연산자 (2단 이상)는 early return으로 풀어낸다.

## API Route Handler

라우트 핸들러는 자연스럽게 가드 절 형식이 된다. zod 파싱 → 도메인 호출 → 에러 매핑 흐름이 곧 early return 패턴이다.

```ts
export async function POST(request: Request) {
  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = await doWork(parsed.data);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json({ error: toMessage(err) }, { status: errorStatus(err) });
  }
}
```

## 예외

- 단순 매핑 함수(`switch` 한 단)는 early return 강제 안 함.
- 의도적으로 if/else 대칭이 가독성을 살릴 때(분기가 시맨틱하게 동등할 때)는 허용.

## ESLint disable 금지

`// eslint-disable-*` 주석은 **거의 절대 쓰지 않는다**. 룰이 잡는 건 대부분 진짜 이슈이거나 더 나은 표현이 있다는 신호다. disable로 묻는 대신 코드를 고쳐 룰을 통과시킨다.

자주 부딪히는 룰별 권장 대안:

- **`react-hooks/set-state-in-effect`**: `useEffect` 안에서 동기적으로 `setState`하는 패턴은 cascading render를 부른다.
  - props/state로 *파생*시켜 계산 (렌더 시 `const x = derive(props)`).
  - 부모에서 조건부 마운트 (`{open && <Child .../>}`) 또는 `key` prop으로 자연스러운 리셋.
  - 정말 effect가 필요하면 사용자 인터랙션 핸들러에서 직접 `setState`.
- **`react-hooks/exhaustive-deps`**: 의존성을 빠뜨리지 말고 모두 적는다. 함수가 매 렌더마다 새로 만들어져 무한 루프가 도는 거라면, 그 함수를 `useCallback` 또는 모듈 스코프로 옮긴다.
- **`@typescript-eslint/no-unused-vars`**: 진짜로 안 쓰이면 지운다. 시그니처 일치를 위해 받아두는 인자라면 `_props`처럼 `_` 접두사.
- **`react-hooks/rules-of-hooks`**: early return 위로 훅을 끌어올린다 (조건부 호출 금지).
- **`@typescript-eslint/no-explicit-any`**: `unknown` + 타입 가드, 또는 정확한 타입 정의로 교체.

### 어쩔 수 없이 disable해야 하는 좁은 예외

- 외부 라이브러리의 알려진 false positive — 인접 코드 주석으로 *왜* 안전한지 한 줄 설명을 *반드시* 같이 쓴다.
- 마이그레이션 중 일시적으로 막아둔 코드 — 같이 TODO와 만료 조건을 적는다.

이 두 경우 외에는 disable을 추가하기 전 "이 룰을 통과하려면 코드를 어떻게 바꿀까"를 먼저 시도한다. 추가하더라도 *파일 전체가 아닌 한 줄*에만 (`// eslint-disable-next-line <rule>`).

기존 코드에 남아 있는 disable 주석은 점진적으로 제거 — 새 코드에는 추가하지 않는다.
