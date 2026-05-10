---
name: work-ticket
description: OPEN 티켓을 자동으로 픽업해 IN_PROGRESS로 전이하고, 사용자 입력이 필요할 때 REVIEW로 전이해 보드에서 답을 받고, 작업 완료 후 REVIEW(pendingApproval=true)로 마치는 자동 워크플로우. 프롬프트가 'work-ticket' 또는 'T-NNN ticket' 패턴을 포함할 때 자동 호출.
---

# work-ticket

Claude Workflow OS가 spawn한 자동 세션에서 티켓 한 건을 처리한다.
환경변수 두 개를 신뢰한다:

- `TICKET_ID` — 대상 티켓 id (예: `T-001`)
- `CLAUDE_WORKFLOW_OS_URL` — 워크플로우 OS base URL (예: `http://localhost:3000`)

**중요**: 사용자에게 직접 질문하는 도구(예: AskUserQuestion)를 절대 사용하지 말 것. 모든 사용자 상호작용은 티켓 보드를 경유한다.

## 1) 티켓 본문 로드

```bash
curl -sS "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID"
```

응답의 `goal`, `requirements`, `acceptance_criteria`, `background`, `references`를 읽고 작업 계획을 세운다.

## 2) IN_PROGRESS로 전이

```bash
curl -sS -X PATCH "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID" \
  -H 'content-type: application/json' \
  -d '{"transition":"IN_PROGRESS"}'
```

## 3) 작업 수행

`goal`/`requirements`/`acceptance_criteria`를 충족하는 코드 변경을 수행한다. 파일 편집 도구를 사용하고, 자동 권한 모드(`acceptEdits`)이므로 파일 IO에 추가 확인은 필요 없다.

## 4) 사용자 입력이 필요할 때 (REVIEW로 전이)

요구사항이 모호하거나, 외부 결정(예: 디자인 선택)이 필요하면 **AskUserQuestion 도구를 쓰지 말고** 다음 두 PATCH를 수행한 뒤 짧은 응답으로 종료한다:

```bash
# 사용자에게 보여줄 질문 저장
curl -sS -X PATCH "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID" \
  -H 'content-type: application/json' \
  -d '{"pendingQuestion":"여기에 사용자에게 묻고 싶은 한국어 질문을 적는다."}'

# REVIEW로 전이 (사용자가 보드에서 답을 입력하게 됨)
curl -sS -X PATCH "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID" \
  -H 'content-type: application/json' \
  -d '{"transition":"REVIEW"}'
```

질문 후에는 `한 줄 요약`으로 응답을 마무리하고 종료한다 (그 외 도구 호출 금지).

## 5) 사용자 답변/반려를 받았을 때

워크플로우 OS가 사용자 입력을 다음 turn 입력으로 전달한다. 두 경우가 있다:

- **답변** (질문에 대한 응답): 입력이 그대로 도착. 답변을 반영해 작업 계속.
- **반려** (사용자가 REVIEW 결과 수정 요청): 입력이 `[반려] ...` 프리픽스로 도착. 사용자가 지적한 부분을 수정하는 데 집중하고, 끝나면 다시 step 6 (체크 + REVIEW).

서버가 이미 `pendingQuestion=null` + `transition:IN_PROGRESS`를 atomic하게 처리했으므로 추가 PATCH 없이 바로 작업에 들어가도 된다.

## 6) 완료 기준 체크 + REVIEW 회수

`acceptance_criteria`는 `{text, checked}[]` 객체 배열이다. 각 기준을 충족할 때마다 해당 항목을 `checked: true`로 갱신하고, 모두 충족되면 REVIEW로 전이한다.

```bash
# (a) 작업이 한 항목을 충족했을 때마다 PATCH로 체크 — 인덱스 기준 전체 배열을 다시 보낸다.
curl -sS -X PATCH "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID" \
  -H 'content-type: application/json' \
  -d '{"acceptance_criteria":[{"text":"...","checked":true},{"text":"...","checked":false}]}'

# (b) 모두 체크되면 사용자 승인 대기 표시
curl -sS -X PATCH "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID" \
  -H 'content-type: application/json' \
  -d '{"pendingApproval":true}'

# (c) REVIEW로 전이 — 사용자가 보드에서 "DONE으로 승인"을 누르게 됨
curl -sS -X PATCH "$CLAUDE_WORKFLOW_OS_URL/api/tickets/$TICKET_ID" \
  -H 'content-type: application/json' \
  -d '{"transition":"REVIEW"}'
```

**중요**:
- 서버는 모든 `acceptance_criteria` 항목이 `checked: true`일 때만 REVIEW → DONE 전이를 허용한다 (불충족 시 409).
- 따라서 작업 완료 자체 판정도 체크박스 기반으로 객관화된다.

마지막에 변경 요약(수정한 파일 목록 + 한 단락 설명)을 출력하고 종료한다.

## 금지

- AskUserQuestion 또는 사용자에게 직접 묻는 도구 호출
- transition 본문에 다른 필드를 같이 넣는 것 (PATCH는 한 번에 하나의 의미만)
- 티켓을 DONE으로 직접 전이 — DONE은 사용자 승인 후 보드에서 처리
