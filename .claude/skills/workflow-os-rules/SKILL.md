---
name: workflow-os-rules
description: |
  claude-workflow-os 레포에서 코드를 수정한 직후 자동 호출.
  변경 파일이 docs/rules/*.md (api·schemas·components·comments·performance·design·imports·style)
  8개 규약에 어긋나는지 짧은 체크리스트로 검토하고, 위반 항목만 콕 집어 알려준다.
when_to_use: |
  코드를 작성·수정·리팩터링한 직후. 또는 사용자가 "rules 점검", "규칙 확인"이라고 명시할 때.
  PR/커밋 직전 셀프 리뷰 용도.
model: sonnet
effort: medium
allowed-tools: [Read, Grep, Glob, Bash]
---

# claude-workflow-os Rules 점검 스킬

이 레포의 `docs/rules/*.md`는 8개의 강제 규약을 정의한다. 새 코드를 짠 직후 매번 사람이 다 외워서 점검하기 어렵다. 이 스킬은 *최근 변경된 파일*을 빠르게 훑어 위반만 보고한다.

## 동작

1. **대상 식별**
   - 인자가 있으면 그 경로(들)를 본다.
   - 없으면 `git diff --name-only` + `git diff --name-only --cached` 합집합. 그래도 없으면 `git status --porcelain` 의 modified/added.
2. **각 파일에 대해, 파일 종류별 핵심 체크만 한다 (모든 규칙을 다 보지 않는다)**:

### `app/api/**/route.ts`
- `runtime = "nodejs"` + `dynamic = "force-dynamic"` 둘 다 선언됐나
- 본문이 4단계(parse → lib 호출 → 에러 매핑 → 응답)를 넘지 않나 — try/catch가 도메인 에러를 삼키지 않나
- `fs.readFile` 같은 IO를 라우트에서 직접 호출하지 않나 (lib로 위임됐나)
- zod 스키마는 `lib/schemas.ts`에 있나, 아니면 라우트 상단인가

### `app/components/ui/**`
- 도메인 타입(`Ticket`, `SessionInfo` 등) import가 절대 없나
- 한 파일 한 컴포넌트 (Card 류 예외)
- 임의 색/임의 px 값 없음 (design.md 토큰만)

### `app/components/<Domain>.tsx`
- raw `fetch`/`axios` 직접 사용하지 않고 `*-client.ts`만 호출
- `useQuery`/`useMutation` 직접 import 대신 도메인 훅 (`use-tickets.ts` 등)
- 200줄 넘으면 분리 후보로 보고
- 도메인 enum → variant는 `*-meta.ts` 매핑인가

### `lib/*-store.ts`, 도메인 lib
- HTTP/UI 의존 없음
- 상태 머신 표는 모듈 상단 const, 가드는 헬퍼로 추출

### 모든 변경 파일 공통
- **JSDoc 누락** — 모든 export 함수/타입/스키마/Props 프로퍼티에 `/** ... */`. 코드 그대로 옮긴 주석은 빈 주석으로 본다 (이름 반복, 타입 반복 X). 단위·범위·도메인 의미·invariant만.
- **import 정렬** — `@/`는 계층 가로지를 때, `./`는 같은 폴더, `../../`는 금지.
- **다크 모드 짝 누락** — 색 클래스에 `dark:` 짝이 없으면 보고.
- **`any` / `z.any()` / `z.unknown()` 사용** 보고.

## 보고 형식

🔍 점검: 개 파일

✓ app/api/foo/route.ts
✗ app/components/Bar.tsx
- JSDoc 누락: BarProps.onClick (line 12)
- dark: 짝 누락: text-zinc-700 (line 45)
✗ lib/foo.ts
- JSDoc 누락: export function processFoo (line 8)

위반이 0이면 한 줄 "✓ 모든 규칙 통과" 만 출력.

## 안 하는 것

- 자동 수정 (보고만 한다 — 사용자가 직접 고친다)
- ESLint가 이미 잡는 항목 (그건 lint가 한다)
- 성능/렌더 분석 (별도 작업)