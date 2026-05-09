# 주석 규칙

## 원칙

이 프로젝트는 **모든 공개 식별자에 JSDoc 주석을 단다**. 단, 주석은 *코드가 말하지 않는 것*만 적는다. 식별자 이름을 그대로 옮긴 주석은 빈 주석과 같다.

## 대상

다음 식별자는 모두 JSDoc(`/** ... */`)을 단다.

- 타입/인터페이스의 모든 프로퍼티
- 함수/메서드 (top-level, exported, public class member)
- 타입 alias, enum, 상수 객체 (`const ALLOWED_TRANSITIONS = ...`)
- React 컴포넌트의 모든 Props 프로퍼티
- zod 스키마의 모든 필드

## 무엇을 적는가

식별자 이름과 타입에서 **자명하지 않은 것**:

- 단위 (`/** 밀리초 */ timeout: number`)
- 허용 범위/제약 (`/** 1~120자. */ title: string`)
- 도메인 의미 (`/** 보드 정렬과 알림 임계값에 사용. */ priority: ...`)
- 부수효과/기대 동작 (`/** 실패 시 swallow. caller는 신경 쓰지 않는다. */`)
- 호출 규약 (`/** 낙관적 업데이트는 호출자 책임. */`)
- 비자명한 invariant (`/** 항상 IN_PROGRESS에서만 true가 될 수 있다. */`)

## 무엇을 적지 않는가

- 타입을 다시 적기 (`/** string */`)
- 이름 반복 (`/** ticket id */ id: string` → 의미 0)
- "TODO" 외 잡담
- 함수 본문 안의 *what* 주석 (변수 추출/이름 짓기로 해결)

## 함수 주석 형식

```ts
/**
 * 다음 상태로 전이한다. 불법 전이는 IllegalTransitionError.
 * @param id 대상 티켓 id.
 * @param next 목표 상태.
 * @returns 갱신된 티켓.
 */
export async function transitionTicket(id: string, next: TicketStatus) { ... }
```

`@param`/`@returns`는 추가 정보가 있을 때만. 타입 시스템이 이미 말하는 것을 반복하지 말 것.

## 컴포넌트 Props

```ts
type TicketCardProps = {
  /** 표시할 티켓. 부모 캐시에서 내려준다. */
  ticket: Ticket;
  /** 액션 버튼 클릭 시 호출. 낙관적 업데이트는 호출자 책임. */
  onAction: (action: TicketAction) => void;
};
```

## zod 스키마

```ts
export const TicketDraftSchema = z.object({
  /** 사용자에게 표시되는 한 줄 요약. 1~120자. */
  title: z.string().min(1).max(120),
  /** 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPrioritySchema,
});
```

## 예외

- 컴포넌트 내부 로컬 헬퍼/상태 변수: 불필요.
- 1줄짜리 자명한 화살표 함수 (e.g. `const trim = (s: string) => s.trim()`): 불필요.
- 테스트 코드: 케이스 이름이 곧 주석 역할을 하므로 강제하지 않는다.
