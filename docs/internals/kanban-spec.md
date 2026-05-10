# 칸반보드 스펙

## 1. 큰 그림 (북극성)

> **사용자가 작업 명세(티켓)를 작성·생성하면, 추가 개입 없이 작업이 완료되도록 한다.**

사용자 개입은 두 지점에서만 허용한다:

1. **티켓 작성 단계** — 목표·요구사항·완료 기준을 정확히 적는다.
2. **REVIEW 단계** — 워커가 명시적으로 묻는 질문에 답하거나, 완료물을 승인한다.

그 외 모든 단계(spawn·전이·재시도·세션 ID 추적·로그 노출)는 자동.

## 2. 도메인 모델

### Ticket (`lib/types.ts`)

| 필드 | 타입 | 의미 |
|------|------|------|
| `id` | `T-NNN` | 자동 발급, 파일명과 일치 |
| `title` | string | 1~120자 한 줄 요약 |
| `goal` | string | 무엇을 왜 |
| `background` | string? | 맥락 |
| `requirements` | string[] | 충족 항목 |
| `acceptance_criteria` | `{text, checked}[]` | 완료 판정 기준. 모두 checked여야 DONE 전이 가능 (서버 강제). 레거시 string[]은 자동 정규화 |
| `references` | string[]? | 관련 파일/링크 |
| `priority` | low/medium/high | 알림 임계값 + 정렬 |
| `status` | OPEN/IN_PROGRESS/REVIEW/DONE/CANCELLED | 상태 머신 |
| `blocked` | boolean | true면 IN_PROGRESS 한정 의미 |
| `blockedReason` | string? | blocked=true일 때 |
| `projectId` | string? | 자동 워커 실행 대상 프로젝트 |
| `currentSessionId` | string? | 워커가 spawn한 활성 세션 |
| `pendingQuestion` | string? | 워커가 사용자에게 묻고 싶은 질문 |
| `pendingApproval` | boolean? | 작업 완료 → 사용자 승인 대기 |
| `workerLog` | string? | 워커 stdout 로그 파일 절대 경로 |
| `created_at` / `updated_at` | ISO 8601 | |

영속화 위치: `tickets/<id>.json`. 외부 편집 가능하지만 SSE 이벤트는 발생하지 않으므로 UI는 새로고침 필요.

### Project (`tickets/.projects.json`)

`{id, name, claudeRoot, workDir?}`. ALL은 예약 id로 글로벌 `~/.claude` 가리킴.

### Session

워커가 spawn한 headless Claude Code 세션. id는 UUID v4. jsonl은 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. 기존 세션 뷰어(`/sessions/[id]`)와 호환.

## 3. 상태 머신

```
OPEN → IN_PROGRESS → REVIEW → DONE
                       ↑         
                       └── 반려
```

`CANCELLED`는 어느 상태에서나 단방향. `DONE`/`CANCELLED`에서 나가는 전이 없음.

권위는 `lib/ticket-store.ts`의 `ALLOWED_TRANSITIONS`. 위반 시 서버 409.

## 4. 자동 워커 라이프사이클

워커는 Next.js 부팅 시 `instrumentation.ts` → `startTicketWorker()`로 한 번 등록(idempotent).

### Spawn 트리거 (claim 조건)

다음을 **모두** 만족할 때만 `spawnHeadlessClaude` 호출:

- `status === OPEN` **또는** `status === IN_PROGRESS && !currentSessionId`
- `projectId`가 등록된 프로젝트 중 하나
- `inFlight`(현재 spawn 진행 중 티켓)에 없음
- `inFlight.size < maxConcurrentTickets` (앱 설정 1~5)

### 트리거 시점

| 시점 | 호출 |
|------|------|
| Next.js 부팅 | `pickupOpenTickets()` — 모든 티켓 훑어 claim 시도 |
| `ticket.created` SSE | 새 티켓 1건 즉시 claim 시도 |
| `ticket.updated` SSE | 위 claim 조건 만족하면 claim |
| 자식 프로세스 `exit` | inFlight 슬롯 비움 + `pickupOpenTickets()` 재호출 |
| 60초 watchdog | (a) IN_PROGRESS 무갱신 N분 → REVIEW + pendingApproval 회수 (b) 죽은 자식 reaper |

### Spawn 명령

```
claude -p --session-id <UUID> \
  --permission-mode <앱 설정의 permissionMode> \
  --append-system-prompt "<work-ticket skill 안내>" \
  "Use the work-ticket skill to handle ticket <id>. ..."
```

환경변수:
- `TICKET_ID`
- `CLAUDE_WORKFLOW_OS_URL` (`http://localhost:<PORT>`)

stdout/stderr → `tickets/.logs/<id>.log`에 append.

부모는 `child.unref()`로 detach. `child.on('exit')` 리스너로 inFlight 회수 + 다음 픽업.

자식 cwd: `project.workDir ?? (claudeRoot 부모 또는 자기 자신)`.

자식은 부모(Next.js)가 자동으로 `.claude/settings.local.json`에 Stop hook을 머지해 둔다 (`scripts/ticket-stop-hook.mjs`).

## 5. 사용자 ↔ 워커 협업 프로토콜

work-ticket 스킬이 보드 API만 통해 사용자와 통신한다 (`AskUserQuestion` 같은 직접 도구 금지).

### 정상 흐름

1. 워커 spawn → 스킬이 `GET /api/tickets/:id`로 본문 로드
2. `PATCH transition:IN_PROGRESS`
3. 코드 작업
4. acceptance_criteria 항목별 `checked:true` PATCH
5. 모두 체크되면 `pendingApproval:true` + `transition:REVIEW`
6. 사용자가 보드에서:
   - **승인** → DONE 전이 (서버가 모든 항목 checked 강제)
   - **반려** (textarea 내용 + 버튼) → 같은 세션 resume + `[반려] ...` 프리픽스로 입력 전달

### 질문 흐름 / 반려 흐름 (통합)

같은 endpoint(`POST /api/tickets/:id/answer`) + 같은 server-side 처리(atomic 정리 + resume)를 공유한다. 의미 차이는 prefix로만:

| 트리거 | 입력 | 사용자 의도 |
|--------|------|------------|
| pendingQuestion 답변 폼 | 자유 텍스트 | 워커 질문에 답 |
| REVIEW 카드 반려 버튼 | `[반려] {reason}` | 작업물 수정 요청 |

서버 동작 (양쪽 동일):
1. `pendingQuestion = null`
2. REVIEW면 `transition:IN_PROGRESS` (이미 IN_PROGRESS면 noop)
3. `spawnHeadlessClaude({ resume:true, sessionId:currentSessionId, prompt })`

스킬은 prefix를 읽어 자유 답변 vs 수정 요청을 구분.

### Stop hook safety net

워커가 명시적으로 REVIEW 전이 안 하고 죽었을 때, Stop hook이 `pendingApproval:true` + `transition:REVIEW`로 자동 회수해 사용자가 처리할 수 있게 한다.

## 6. UI 스펙

### 보드 페이지 (`/board`)

- 헤더: 제목 + i 버튼 (BoardHelpModal — 동작 설명) + "새 티켓" CTA
- ProjectTabs: ALL / 등록 프로젝트들 / 추가 버튼. 활성 id는 URL `?project=<id>`
- 본문:
  - **ALL 뷰**: 등록 프로젝트 순서대로 섹션 + 디바이더(`border-t`, 첫 섹션 제외). 각 섹션 헤더 = 프로젝트 이름 + 건수. 미등록 projectId/미지정 티켓은 마지막 "(미지정 프로젝트)" 섹션
  - **단일 프로젝트 뷰**: 4-컬럼 (OPEN/IN_PROGRESS/REVIEW/DONE). CANCELLED는 의도적으로 숨김
- DnD: `@dnd-kit/core`. 카드 좌측 grip → 컬럼 droppable. 드롭 시 transition. 무효 전이는 서버 409 → 토스트
- 가드: REVIEW→IN_PROGRESS 드래그는 `pendingQuestion` 있으면 클라이언트에서 차단

### 카드

- 좌측: 드래그 grip
- 본문 클릭 → 편집 모달 (`?ticket=<id>`)
- 뱃지: priority / project / agent / 차단됨 / 런타임 상태(질문 대기/승인 대기/워커 실행/큐 대기)
- 액션: 상태별 버튼 (시작/복제 · 검토 요청/차단 · 승인/반려 · 답변 폼)
- 답변 보낸 후엔 폼 사라지고 "답변 전송됨 · 워커 응답 대기 중" 표시
- 우측 하단: 세션 보기 외부링크(있을 때) + 휴지통(ConfirmDialog)

### 편집 모달

- URL `?ticket=<id>` 단일 진실 원천 (알림 라우팅과 일관)
- 상단: `WorkerLogPanel` — `currentSessionId` 또는 `workerLog` 있을 때만. 5초 폴링으로 stdout tail (마지막 32KB) + 세션 점프 + refresh
- 본문: `NewTicketForm`을 편집 모드로 재사용 (`editingId` prop)

### 전이 펄스

`useTransitionPulse` 외부 store. SSE `ticket.updated` (status 변경)에서 `markTransition(id)` → 1.5초 동안 카드에 의미색 ring + animate-pulse. 드래그/버튼/워커 트리거 모두 일관.

### 알림

- 전이 토스트 단일 발행 = SSE에서 (`use-tickets.subscribeToTicketStream`). mutation onSuccess는 토스트 안 띄움
- `notify({ category: 'ticket', href: '/board?ticket=<id>' })` — 알림 클릭 시 해당 카드 모달 자동 오픈
- Web Push: `IN_PROGRESS && blocked=true` 진입 시 + `REVIEW` 진입 시 (`lib/web-push.ts` + `ticket-store.ts`)

## 7. 실시간 / 캐시

- 진실 원천: TanStack Query `["tickets"]`
- 초기 로드: `GET /api/tickets`
- 변경 머지: SSE `/api/sse` → `setQueryData` (refetch 트리거 아님)
- 변경 SSE 이벤트: `ticket.created` / `ticket.updated` / `ticket.deleted`
- 워커 로그는 별개 키 `["worker-log", id]`로 5초 폴링

## 8. 보안 / 신뢰 경계

- 모든 zod 검증은 HTTP 경계에서만 (`/api/*` Route Handler)
- 자체 파일(`tickets/*.json`)은 신뢰 — 외부 도구가 깨뜨리면 SSE 이벤트는 안 발생
- 워커 로그 라우트는 `path.resolve(workerLog).startsWith(ticketsDir())` 강제로 path traversal 차단
- 자식 Claude의 권한 모드는 사용자 앱 설정(`permissionMode`)을 그대로 전달. `bypassPermissions`면 curl PATCH 차단 없이 동작

## 9. 메트릭 / 관찰

- 모든 `/api/*`는 `withMetrics` wrap → Prometheus `/api/metrics`. 동적 segment는 `:id`로 정규화
- `lib/cache.ts`의 `createCache(name)`이 hit/miss/size 자동 expose
- `/monitoring` 페이지에 라우트별 p99 차트

## 10. 알려진 한계

- 외부에서 ticket 파일을 직접 수정하면 SSE 이벤트가 안 발생 (의도)
- DnD는 5px activation distance — 모바일/태블릿에서는 long-press 추가 필요
- `maxConcurrentTickets`는 1~5 (zod 강제). 그 이상 필요하면 schemas.ts 수정

---

# 구현 감사 (스펙 ↔ 코드)

## ✅ 잘 맞는 부분

- 상태 머신 (`ALLOWED_TRANSITIONS`) — 단일 진실, 권위 명확, `assertTransition` 가드
- SSE 단일 시임 (`ticketEvents` EventEmitter) — store만 emit, 외부 모듈은 listen만
- URL이 뷰 진실 원천 — `?project`, `?ticket` 모두 새로고침/공유 안전
- TanStack Query 캐시 + setQueryData 머지 — refetch 폭주 없음
- `withMetrics` 일관 적용 — 카디널리티 폭주 차단
- 워커가 `mergeStopHook` 자동 — 사용자가 잊어도 스킬→사용자 회귀 보장
- 알림 카테고리/href 일관 — 알림 클릭 → 정확한 카드 모달
- 전이 펄스 + 카드 런타임 뱃지 — 워커 진행을 보드에서 즉시 인지

## ⚠️ 갭 / 의심 지점

### 1. 답변 후 상태 정리 *(해결됨)*

`app/api/tickets/[id]/answer/route.ts`가 spawn 직전 server-side에서 `pendingQuestion = null` + `transition: IN_PROGRESS` 처리. 스킬 누락/지연에도 보드 상태가 즉시 정확히 반영된다.

### 2. T-001 같은 projectId 없는 티켓

부팅 픽업/이벤트 모두 projectId 없으면 silent skip — 사용자에게 "이 티켓은 워커가 픽업 안 함"을 명시해주는 UI 신호가 없다. 카드 런타임 뱃지에 "프로젝트 미지정" 등 추가 권장.

### 3. inFlight Set과 hot-reload 모순

핫리로드로 워커 모듈이 새로 로드되어도 `isStarted` 플래그 + 클로저 EventEmitter listener가 이전 인스턴스를 가리킬 수 있음. dev 환경에서 종종 inFlight가 stale → spawn 멈춤. watchdog reaper가 완화하지만 60초 지연. dev에서 더 자주 도는 모드(예: 10초) 검토.

### 4. permissionMode 기본값이 default

신규 사용자는 `default` 모드 → 헤드리스 자식이 권한 프롬프트에서 멈춰 즉시 사실상 무력. 첫 사용시 안내 또는 기본값을 `acceptEdits`로 권장 노출 필요.

### 5. acceptance_criteria가 단순 string[] *(해결됨)*

`{text, checked}[]` 구조로 확장 완료. 사용자/스킬 모두 토글 가능. 서버는 모든 항목 checked일 때만 REVIEW→DONE 전이 허용 (불충족 시 409). 레거시 string[]은 read 시 자동 정규화 (`{text, checked: false}`).

### 6. 워커 재시도 정책 *(부분 해결)*

비정상 종료(exit code != 0 또는 signal로 죽음) 시 자동으로 `pendingQuestion`에 실패 사유 기록 + REVIEW 전이 → Web Push로 사용자 즉시 인지 + 보드 카드에 답변 폼 표시. 사용자가 답변하면 그 내용으로 자동 재시도(`/api/tickets/:id/answer` → resume).

남은 향상: N회 자동 재시도(exponential backoff) 옵션 — 현재는 사용자 답변 한 번에 한 번만 재시도.

### 7. 동시성 한도 의미 약함

`maxConcurrentTickets` 1~5가 전역. 프로젝트별 한도가 없어 한 프로젝트가 모든 슬롯 점유 가능. 멀티 프로젝트 사용자는 사실상 직렬. 프로젝트별 슬롯 1개씩 + 전역 상한으로 분리 검토.

### 8. 대용량 티켓 / 긴 로그 / 긴 세션

- WorkerLogPanel은 32KB만 노출 — 더 보고 싶으면 `/sessions/<id>` 점프지만 그건 jsonl 본문이지 stdout 아님. stdout 풀 뷰어 부재
- jsonl이 크면 5초 폴링 비용↑. ETag 활용 안 됨

### 9. 카드 뱃지 정보 밀도

priority + project + agent + 차단됨 + 런타임 4종 → 한 카드에 5~6개 뱃지가 줄넘김. 카드 컴팩트성↓. 토글로 숨기거나 priority/project를 헤더 영역에 통합 검토.

## 🚀 개선 우선순위 추천

| # | 항목 | 효과 | 난이도 |
|---|------|------|--------|
| 1 | answer → resume 전체 흐름 검증 + 스펙대로 동작 | 큰 골 직결 | 중 |
| 2 | acceptance_criteria 체크박스 구조화 | 진짜 자동화 가능 | 중 |
| 3 | 워커 비정상 종료 시 자동 REVIEW 회수 + 알림 | 사용자 개입 신호 | 소 |
| 4 | permissionMode 기본값/신규 사용자 안내 | 첫 경험 | 소 |
| 5 | 카드 뱃지 정보 밀도 정리 | UI 가독성 | 소 |
| 6 | 프로젝트별 동시성 한도 | 멀티 프로젝트 UX | 중 |
| 7 | 워커 재시도 정책 (옵션) | 안정성 | 중 |
| 8 | dev 환경 워커 핫리로드 안정화 | 개발 생산성 | 중 |
| 9 | 워커 stdout 풀 뷰어 | 디버깅 | 중 |
| 10 | `projectId` 미지정 카드 시각 신호 | 발견성 | 소 |

`#1 + #2 + #3` 콤보가 큰 골("사용자 개입 최소화로 작업 완료")에 가장 직접적으로 기여한다. #1은 현재 코드가 이미 동작하고 있는지 검증부터; #2는 스킬과 보드 양쪽 작은 스키마 변경; #3은 worker.ts에 exit code 분기 한 단락.
