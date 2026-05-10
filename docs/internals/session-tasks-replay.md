# Session Tasks — Replay 규칙

> `lib/session-tasks.ts`의 `replaySessionTaskTimeline` 이 세션 jsonl 본문에서
> `(events, finalTasks)` 를 어떻게 도출하는지 정리. 그래프(`SessionTaskGraphView`)
> 와 라이브 카드 모두 이 규칙 위에서 동작한다. jsonl 카탈로그는
> `session-jsonl-spec.md` 단일 진실 원천을 참조.

## 1. 두 task 시스템 — TodoWrite vs TaskCreate/TaskUpdate

Claude Code 는 헤드리스/인터랙티브 두 경로로 task 를 관리하며, 디스크 위치도
도구도 다르다. 우리 replay 는 둘 다 한 timeline 으로 합친다.

| 항목 | TodoWrite (헤드리스 / 단일 에이전트) | TaskCreate / TaskUpdate (인터랙티브 / TeamCreate) |
|---|---|---|
| 도구 이름 | `TodoWrite` | `TaskCreate`, `TaskUpdate`, `TaskGet`, `TaskList`, `TaskStop` |
| 디스크 위치 | `~/.claude/todos/<sessionId>-agent-<sessionId>.json` (배열 한 파일) | `~/.claude/tasks/<sessionId>/<id>.json` (한 파일 = 한 태스크) |
| id 의미 | 배열 인덱스 → `1, 2, ...` (자체 합성) | harness *전역* 시퀀스 (`toolUseResult.task.id`, 한 세션이 18·19·20·21 같이 커질 수 있음) |
| 호출 형식 | *전체 list 스냅샷*. 매 호출이 todos 배열 통째 | 도구별 입력 (`subject`, `taskId`, `status`, `addBlocks`, ...) |
| 활성화 조건 | 일반 단일 세션의 todo 트래킹 | TeamCreate 멤버 간 공유 task 보드 등 multi-agent 협업 |
| 자동 정리 | claude 본체가 완료/삭제 시 `.json` 파일 삭제 | 동일 (라이브 뷰가 파일 시스템에 의존) |

라이브 뷰 (`readSessionTasks`) 는 우선 `tasks/` 폴더를 보고, 비어있으면
`todos/` 파일을 본다. 이력 뷰 (`replaySessionTaskTimeline`) 는 *jsonl 본문을
재생*해서 두 도구 호출을 시간순으로 fold 한다 — 라이브 파일이 지워져도 timeline
은 jsonl에서 복원된다 (단, jsonl 256KB truncate 분만큼 부정확).

## 2. TaskCreate id 확정 — `tool_use_id` 보류

`TaskCreate.input` 에는 `taskId` 가 없다. Claude Code 2.1+ 는 *envelope* 의
`toolUseResult.task.id` 로 진짜 id를 부여한다 (E11). 우리 replay는:

1. `TaskCreate` 만나면 `synthCounter` 로 placeholder id 를 두고 `pendingByUseId.set(toolUseId, ...)` 에 보류.
2. 같은/후속 라인의 `tool_result` 에서 `extractTaskResultId` 로 `(toolUseId, taskId)` 회수.
3. 보류 task 의 id 를 진짜 id 로 교체 + `events.push({kind: "create"})`.

`tool_use_id` 가 누락된 비상 케이스는 즉시 placeholder id 로 확정 (방어적 fallback).

## 3. TodoWrite 슬롯 재할당 분기 — 같은 자리, 다른 의미

`TodoWrite` 는 매 호출이 *전체 todos 배열 스냅샷* 이다. 인덱스 기준 diff 로
create/update 를 합성하는데, **같은 슬롯 i 에 subject 가 다른 todo 가 들어오면
그건 새 logical task** (이전 todo 가 닫히고 새 todo 가 열린 것). 이를 같은 id
로 묶으면 그래프에서 한 노드 안에 무관한 작업 두 개가 섞인다.

규칙:

```
prev[i].subject === todos[i].content   ⇒ 같은 logical task. 기존 id 유지.
prev[i].subject !== todos[i].content   ⇒ 분기:
                                          1) 이전 task 를 update(status: "deleted") 로 닫음
                                          2) 같은 슬롯의 reuse 카운터 +1
                                          3) 새 id 로 create 이벤트 발행
```

id 형식 (slot, reuse):

| reuse | id 예시 |
|---|---|
| 1 (첫 등장) | `"1"`, `"2"`, `"3"`, ... |
| 2 (한 번 재할당) | `"1.2"`, `"2.2"`, ... |
| 3 (두 번 재할당) | `"1.3"`, ... |

UI(`SessionTaskGraphView`)는 lane 정렬을 *(slot, reuse) 사전식* 으로 하고,
reuse > 1 lane 은 ↳ prefix + 들여쓰기로 부모-파생 관계를 시각화한다.

`prev` 보다 짧아진 호출은 잘려나간 슬롯들을 update(status: "deleted") 로 닫는다.

## 4. `finalTasks` 도출 — events fold

`finalTasks` 는 *마지막 TodoWrite 스냅샷* 이 아니라 events 배열을 taskId 기준
fold 한 결과다.

```ts
const finalById = new Map<string, SessionTask>();
for (const ev of events) finalById.set(ev.taskId, ev.snapshot);
const finalTasks = Array.from(finalById.values()).sort(byNumericId);
```

이유 (E12): TodoWrite 가 슬롯 재할당으로 잘라낸 옛 task (`"1"` 이 deleted 로
닫힌 뒤 `"1.2"` 가 새로 등장) 는 마지막 스냅샷 배열에는 없다. 하지만 *이력 뷰*
는 deleted 까지 보여줘야 그래프와 라이브 카드의 의미가 일치한다 — 그래서 events
를 fold 해서 모든 등장 id 를 보존한다.

`events` 가 비어있는 비정상 케이스만 `created` (raw TaskCreate placeholder 목록)
로 fallback.

## 5. 정렬 — line 순서 ≠ 시간순

`readSessionBundle` 은 메인 jsonl 뒤에 서브에이전트 jsonl 들을 *file 순서로*
concat 한다 (E6). replay는 진입 직후 ts 기준 stable sort 로 시간순을 보장한다.
정렬 안 하면 sidechain 의 빠른 ts 업데이트가 메인의 늦은 ts 업데이트를 덮어
finalState 가 틀어진다.

## 6. 캐시

`replay-task-timeline` named cache (`createCache`) 가 fingerprint 기반 무효화.
fingerprint 는 메인+서브에이전트 모든 파일의 `(path, mtime, size)` 직렬화
(`readSessionBundle` 이 계산). 어느 파일이 바뀌어도 자동 무효화 — 단일 파일
mtime 만으론 sidechain 추가/append 를 놓친다.

## 7. 참조

| 영역 | 파일 |
|---|---|
| replay | `lib/session-tasks.ts` (`replaySessionTaskTimeline`) |
| 라이브 | `lib/session-tasks.ts` (`readSessionTasks`, `readFromTasksDir`, `readFromTodosFile`) |
| 그래프 | `app/components/SessionTaskGraphView.tsx` (`buildLayout`, `parseSlot`) |
| 카탈로그 | `docs/internals/session-jsonl-spec.md` §7, §8 (E4/E11/E12) |
