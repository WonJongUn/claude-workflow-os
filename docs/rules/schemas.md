# 스키마 (zod) 규칙

## 위치

- 공유 스키마: `lib/schemas.ts`
- 라우트 한정 스키마: 해당 `route.ts` 상단

## 도메인 타입 동기화

zod 스키마는 `lib/types.ts`의 도메인 타입과 동기화한다.

```ts
export const TicketDraftSchema = z.object({...}) satisfies z.ZodType<TicketDraft>;
```

`satisfies`로 컴파일 타임 검증. 불일치 시 빌드 실패한다.

## 프로퍼티 주석 필수

스키마와 도메인 타입의 모든 프로퍼티에 의도/제약을 적는다. 코드만 보고 알 수 없는 정보를 담는다 (단위, 허용 범위, 도메인 의미). 빈 주석/타입 반복 금지.

```ts
export const TicketDraftSchema = z.object({
  /** 사용자에게 표시되는 한 줄 요약. 1~120자. */
  title: z.string().min(1).max(120),
  /** 담당 에이전트 슬러그. 미지정 시 라우팅에서 결정. */
  agent: z.string().optional(),
  /** 무엇을, 왜 해야 하는지 한 단락 이상. */
  goal: z.string().min(1),
  /** 우선순위. 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPrioritySchema,
});
```

도메인 타입(`lib/types.ts`)에도 동일하게 JSDoc을 단다. 둘이 어긋나면 타입 우선.

## 검증 위치

- HTTP 경계 (Route Handler `request.json()`)에서만 zod 검증.
- 자체 파일(`tickets/*.json`), 내부 함수 인자는 검증하지 않는다 — 타입 신뢰.
- 외부 API 응답을 받아쓸 때는 검증한다 (현 단계 없음).

## 추론 vs 선언

- **선언 우선**: 도메인 타입은 `lib/types.ts`에 손으로 적는다 (가독성, JSDoc 위치).
- 라우트 한정 / 부속 타입은 `z.infer<typeof Schema>`로 추론해서 중복 제거.

## 에러 응답

```ts
const parsed = Schema.safeParse(body);
if (!parsed.success) {
  return Response.json(
    { error: "Invalid body", issues: parsed.error.issues },
    { status: 400 },
  );
}
```

issues를 그대로 노출한다 (로컬 도구이므로). 외부 노출이 생기면 정제.

## 마크다운 프론트매터

에이전트/스킬 같은 `.md` 파일의 YAML 프론트매터는 `lib/frontmatter.ts`의 `parseFrontmatter`/`stringifyFrontmatter`만 사용한다 (외부 YAML 의존성 없음).

지원 범위:
- 단일 줄 `key: value`
- 인라인 배열 `[a, b]`
- 다중행 배열 (`key:` + 들여쓴 `- item` 줄들)
- 다중행 블록 스칼라 (`key: |` + 들여쓴 본문) — strip 변형 `|-`도 지원
- 선행 공백/개행이 있는 입력 (raw 붙여넣기 보호)

직렬화 시 줄바꿈이 들어간 문자열은 자동으로 `|` 블록으로 emit한다 (왕복 안정성).

지원 안 함 (의도적):
- folded scalar (`>`)
- 중첩 매핑

UI 폼은 프론트매터 필드를 **구조화된 input**으로 분리해 사용자가 raw text를 직접 작성하지 않게 한다 (`SkillForm`, `AgentForm`). 본문(body)만 마크다운 textarea.

## 금지

- `z.any()`, `z.unknown()` 남발 (정확한 타입을 못 잡으면 도메인 모델을 다시 본다)
- 스키마 안에서 부수효과 (`z.transform`으로 DB 조회 등)
- 같은 스키마를 라우트 여러 곳에 복붙 — `lib/schemas.ts`로
