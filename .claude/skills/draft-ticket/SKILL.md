---
name: draft-ticket
description: 사용자 한 줄 요청을 받아 이 레포의 컨벤션(CLAUDE.md + docs/rules/*.md)에 맞춰 칸반 티켓 스펙(title/goal/background/requirements/acceptance_criteria/references/priority)을 자동으로 짜고, 사용자 확인 후 /api/tickets로 POST하는 워크플로우. 사용자가 *티켓을 새로 만들려는 의도*를 보일 때 호출 — 동사형 트리거: "티켓 만들어줘", "…하는/하도록 티켓 만들어줘", "티켓으로 만들어줘", "티켓으로 등록", "티켓 스펙으로 정리해줘", "칸반(보드)에 추가/등록", "/draft-ticket …", "/api/tickets로 POST". 단순 조회·상태 질문("그 티켓 어떻게 됐어?", "T-NNN 상태")이나 기존 티켓 수정 요청에는 호출하지 않는다 — 그 경우는 work-ticket 또는 직접 PATCH.
---

# draft-ticket

칸반 보드 티켓을 *손으로 JSON 짜지 않고* 한 줄 요청에서 시작해 만든다.
티켓이 만들어지면 `ticket-worker`가 OPEN을 픽업해 자동으로 작업을 돌리므로,
스펙 품질이 곧 작업 품질이다 — 이 스킬의 책임은 그 스펙을 정확히 짜는 것.

## 입력

사용자의 한 줄~한 단락 요청. 예:
- "전체 lint 에러를 줄여줘"
- "세션 상세에 검색 기능을 추가하고 싶어"
- "/draft-ticket 디자인 토큰 점검"

## 1) 컨텍스트 로드

티켓 본문에 *왜·무엇을·어떻게 판정할지*가 정확히 박혀야 워커가 헤매지 않는다.
다음을 읽고 헤드를 채운다 — 이미 같은 세션에서 읽었으면 재독은 생략.

- `CLAUDE.md` (프로젝트 전반 규약)
- `AGENTS.md` (Next.js 버전 주의)
- `docs/rules/api.md`, `schemas.md`, `components.md`, `comments.md`,
  `performance.md`, `design.md`, `imports.md`, `style.md`
- 요청과 직접 관련된 디렉터리 (예: 디자인이면 `app/components/ui/`,
  성능이면 `lib/cache.ts` + `lib/metrics.ts`)

## 2) 프로젝트 매핑

티켓의 `projectId`는 워커가 어떤 `claudeRoot` 에서 실행할지 결정한다.

```bash
cat tickets/.projects.json
```

cwd가 매핑된 `claudeRoot` 의 부모 디렉터리이면 그 프로젝트의 `id`를 쓴다.
이 레포(claude-workflow-os) 자기 자신을 가리키는 `id` 가 기본값.
모호하면 사용자에게 단답형으로 묻는다 (한 번만).

## 3) 티켓 draft 작성

다음 필드를 *모두* 채운다. 빈 필드를 두지 않는다 (생략 가능 필드라도 컨텍스트 있으면 적는다).

| 필드 | 작성 가이드 |
|---|---|
| `title` | 한 줄, 동사로 끝나도록 (예: "세션 상세에 검색 추가"). 120자 이하. |
| `goal` | "무엇을, 왜" 한 단락. 모호한 형용사("개선") 대신 측정 가능한 결과("p99 < 2s"). |
| `background` | 의사결정 맥락. 최근 관련 변경/이슈/제약. 사용자가 직접 말한 동기를 그대로 반영. |
| `requirements` | 구체 제약 목록. 관련 docs/rules 항목을 *인용*해 추적 가능하게: "docs/rules/api.md: 모든 새 라우트는 `withMetrics` wrap". 7~12개 권장. |
| `acceptance_criteria` | *체크박스로 객관 판정 가능한* 기준만. "lint 통과" 같이 자동 판정 가능한 항목 우선. 4~8개 권장. |
| `references` | 관련 파일 절대/상대 경로 + 관련 rule 문서. URL은 사용자가 명시한 것만. |
| `priority` | `low`/`medium`/`high`. 기본 `medium`. 사용자가 "급해"라고 말하면 `high`. |
| `agent` | 보통 `general-purpose`. 명시적 도메인이면 그 슬러그(예: `team-lead`). |

draft 작성 시 다음 규칙을 *반드시* 따른다:

- `requirements` 항목은 docs/rules 인용형식("docs/rules/<file>.md: …")을 우선 채택해 워커가 위반 검증 시 직접 참조하게 한다.
- `acceptance_criteria` 에는 *반드시* `pnpm lint` + `npx tsc --noEmit` 무에러 항목을 포함한다 (기존 베이스라인 에러는 명시적으로 예외).
- 티켓이 보고서를 만드는 종류면 `acceptance_criteria` 에 보고서 경로를 박아둔다(예: `docs/audit/<YYYY-MM-DD>.md` 가 작성됨).
- 외부 API/세션 ID 같이 *동적인 값* 은 placeholder 대신 사용자에게 묻거나 보류 상태로 남긴다.

## 4) 사용자 확인

draft 한 본을 마크다운으로 보여준다. 한 화면에 들어오게 정렬:

```markdown
## 티켓 draft

**title**: 세션 상세에 검색 추가
**projectId**: P-moy68swi-xy14 (agentic-os)
**priority**: medium
**agent**: general-purpose

**goal**:
…

**background**:
…

**requirements**:
1. docs/rules/components.md: 새 입력 primitive는 `Field` 사용
2. …

**acceptance_criteria**:
- [ ] 검색 입력에서 ↑↓로 결과 이동
- [ ] pnpm lint 무에러 (베이스라인 외)
- …

**references**:
- app/sessions/[id]/page.tsx
- docs/rules/components.md
```

확인 문구로 닫는다: **"이대로 만들까? (`yes` / 수정사항)"**.

수정 요청이 오면 그 부분만 갱신해 다시 보여준다.
같은 화면에 모달처럼 띄우고, draft 본문을 `tickets/.drafts/<sessionId>.json` 같이 디스크에 저장하지 *않는다* — 사용자 응답이 진실 원천.

## 5) POST

확인 받으면 한 번만 보낸다.

```bash
curl -sS -X POST "$CLAUDE_WORKFLOW_OS_URL/api/tickets" \
  -H 'content-type: application/json' \
  --data @<(cat <<'JSON'
{ ...최종 draft... }
JSON
)
```

`CLAUDE_WORKFLOW_OS_URL` 미설정이면 기본 `http://localhost:3000` 사용.
응답에서 `id` (`T-NNN`) 를 꺼내 다음 정보를 한 줄로 출력하고 종료:

```
✅ T-NNN 생성됨 — http://localhost:3000/board?ticket=T-NNN
```

## 6) 사후

- 워커가 *자동으로* OPEN을 픽업하므로 추가 transition PATCH는 *하지 않는다*.
- 사용자가 "지금 바로 그 티켓 작업해줘" 라고 말하면 새 세션이 자동으로 spawn될 때까지 기다리지 말고, 보드 링크만 안내한다.
- 사용자가 만든 티켓이 *현재 진행 중인 작업*과 충돌하면(같은 파일을 건드릴 가능성) draft 단계에서 미리 알린다.

## 금지

- 사용자 확인 없이 POST.
- requirements/acceptance_criteria 를 한 줄짜리 모호 문장만으로 채움 ("코드 정리"·"잘 동작" 같은 비측정 표현).
- title/goal에 PR 본문 같은 다단락 글 — 한 줄/한 단락 규칙 유지.
- 같은 세션에서 *같은 의미의 티켓* 중복 생성. 직전에 만든 티켓 id를 기억하고 사용자가 명시적으로 "또 하나" 라고 말할 때만 추가.
- 사용자가 묻지 않은 항목을 임의로 `pendingApproval` / `currentSessionId` / `workerLog` 같은 워커 전용 필드에 채우는 것.

## 입력 예시 → draft 골격

| 사용자 입력 | title | priority | requirements 첫 줄 |
|---|---|---|---|
| "전체 lint 에러 줄여줘" | "잔여 lint 에러 정리 (set-state-in-effect 등)" | medium | docs/rules/style.md: ESLint disable 금지 — 코드 수정으로 통과 |
| "세션 상세에 검색 추가" | "세션 상세에 본문 검색 기능 추가" | medium | docs/rules/components.md: 새 입력 primitive는 `Field` 사용 |
| "디자인 토큰 점검" | "design.md 위반 색/간격 일괄 점검" | low | docs/rules/design.md: 임의 hex/픽셀값 사용 금지 |

이 표는 시작점일 뿐 — 실제 draft는 위 4단계로 새로 짠다.
