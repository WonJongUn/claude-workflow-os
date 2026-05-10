# TraceV2 — 표현 스펙

> Trace V2(`app/components/SessionTraceV2View.tsx`)가 세션 jsonl을 어떤 시각 모델로 보여주는지 정리.
> jsonl 스키마는 `docs/internals/session-jsonl-spec.md`를 단일 진실 원천으로 참조한다.

## 1. 모델 — turn 그룹 + turn 안 nesting

세션 1개 = 1 trace. trace 안에 turn 헤더와 그 자손 span 트리.

```
trace
├─ turn 1 (depth 0, kind="turn")               ← 사용자 user 입력 = 그룹 헤더
│  ├─ assistant text/thinking (depth 1)
│  ├─ tool_use (Bash) (depth 1, kind="tool")
│  ├─ tool_use (Agent) (depth 1, kind="tool")  ← 메인 thread Agent 호출
│  │  ├─ sidechain tool_use (depth 2, kind="sidechain")
│  │  └─ sidechain tool_use (depth 2, kind="sidechain")
│  └─ sidechain tool_use (depth 1, kind="sidechain")  ← 부모 Agent가 다른 turn이라 turn 직계
└─ turn 2 ...
```

### 결정 사항

- **turn 우선**: 사용자 user 입력 한 줄이 그룹 단위. 모든 자손은 그 turn에 속한다 (시간상 그 turn 안에서 발생한 이벤트).
- **turn 안에서만 nesting**: sidechain 도구는 같은 turn 안의 부모 Agent tool_use 아래로 배치. 부모 Agent를 같은 turn에서 못 찾으면 turn 직계 자식.
- **cross-turn nesting 금지**: TeamCreate idle wake-up 같은 비동기 활동은 spawn turn이 아닌 *발생 turn*에 귀속. 의도적 결정 — 시간 인지를 깨고 추측 매핑을 만들지 않기 위함.

## 2. span 종류 (`kind`)

| kind | 출처 | depth | 색상 토큰 |
|---|---|---|---|
| `turn` | 메인 user 라인 | 0 | zinc (그룹 헤더) |
| `assistant` | 메인 assistant 텍스트/thinking | 1 | emerald |
| `tool` | 메인 tool_use (sidechain=false) | 1 | sky |
| `sidechain` | sidechain tool_use 또는 sidechain assistant | 1 (turn 직계) 또는 2 (Agent 아래) | violet |

→ 색 매핑은 design.md 디자인 시스템 토큰 준수.

## 3. span id 정책 — 합성 키

**`n${nodeIdx}`** (trace 전역 단조 증가 인덱스). turn id는 `turn-${i}`.

배경: 메인 + 다중 서브에이전트 jsonl 합본에서 같은 `raw.uuid`가 여러 파일에 중복 등장하는 케이스 관측됨 (TeamCreate idle wake-up 시점에 같은 lead message uuid가 모든 팀원 jsonl에 mirror됨). uuid를 span id로 쓰면 React key 충돌로 일부 행이 누락된다.

→ span id는 의미 없는 합성 키, 콘텐츠 매칭/lookup은 별도 보조 맵으로.

## 4. 부모 매칭 (sidechain → Agent tool_use)

`lib/sessions.ts:buildSubagentParentMap`이 `agentId → 부모 Agent toolUseId`를 빌드. 트리 빌드는 turn 단위 인덱스(`nodeByToolUseId`)로 같은 turn 안에서만 매칭.

| 단계 | 키 | 적용 |
|---|---|---|
| 1 | 같은 promptId에서 `meta.description == input.description` | 일반 Agent 호출 |
| 2 | 같은 promptId에서 `meta.agentType == input.name` | TeamCreate 첫 spawn 직후 first batch |
| 3 | 같은 promptId에 후보가 단 하나면 그것 | disambiguate 불필요 |
| 4 | (전역 fallback) TeamCreate spawn 중 `input.name == meta.agentType` 가장 이른 ts | TeamCreate idle wake-up 회수 |

### Wake-up 회수의 배경

Claude Code의 TeamCreate는 idle 팀원이 다시 활성화될 때 **새 `agent-<id>.jsonl` 파일**을 만든다(같은 logical 팀원이 여러 agentId를 갖는다). 그 파일의 first-line `promptId`는 *wake 시점의 lead promptId*로 stamp되는데, 정작 그 파일의 이벤트들은 이전 작업 시점 ts를 그대로 가질 수 있다 (검증: 다중 wake 케이스에서 first-line ts < first-line promptId 시점 lead ts 관측).

→ promptId 기반 매칭(1~3단계)은 wake batch에서 실패한다. 4단계는 `team_name + name`이 한 세션에서 unique하다고 가정하고 가장 이른 spawn으로 묶는다 — 같은 (team, name)이 여러 번 별도로 spawn되면 misattribution 가능하지만 전형적 사용에선 충분.

매칭 실패 → sidechain은 turn 직계 자식. 단 trace 레벨 인덱스(`chipLabelByAgentId`)에서 부모 라벨을 가져와 행 식별 칩만은 부착한다.

## 5. 라벨 / 식별 표시

### 좌측 (행)
도구 이름만 (`Bash`, `Agent`, `TeamCreate`, ...). Team/Name/Type 같은 식별 필드는 좁은 행에 안 넣는다.

긴 라벨은 `truncate` + native `title` (디자인 시스템 예외 — Tooltip portal은 long list 비용 큼).

### 우측 (상세 패널 — span 클릭 시)
- 헤더에 kind 뱃지 + span 라벨 + 시간/지속
- `소속 [backend]` 칩 (sidechain일 때, violet)
- Spawn 메타 박스 (Agent/TeamCreate 도구일 때): `Team: x · Name: y · Type: z`

## 6. 시간 정렬 보장

`readSessionBundle`은 *파일 순서*(path 오름차순)로 concat한 본문 — 시간순 아님. `buildTrace` 진입 직후 `events.filter(ts).sort(ts)`로 ts 오름차순 재정렬.

## 7. 접기/펼침 정책

기본:
- **마지막 turn만 펼침**, 그 외 turn은 접힘
- turn 외 span(tool, sidechain 등)은 기본 펼침 (자식 있으면 토글 가능)

사용자 토글은 `userOverride` Map에 저장 — 명시적으로 토글한 항목만 기본 정책을 덮어씀.

## 8. 알려진 한계

| # | 항목 | 의도 |
|---|---|---|
| L1 | TeamCreate cross-turn 활동은 spawn한 부모 Agent와 nesting되지 않음 | 의도 (§1) |
| L2 | sidechain TaskCreate는 메인 task 그래프와 합쳐지지 않음 | 의도 (E2 충돌 회피) |
| L3 | 한 라인 멀티블록 분리 시 → 현재는 toParsed가 라인당 1 ParsedEvent로 수렴 | 데이터 손실 가능, 미해결 |
| L4 | Agent 호출 결과의 final summary는 trace에 nesting되지 않음 | 의도 (메인 tool_result에 흡수) |
| L5 | attachment 라인(plan_mode 등)은 기본 META_TYPES로 skip됨 | 의도. 향후 노출 검토 |

## 9. 참조 파일

| 영역 | 파일 |
|---|---|
| jsonl 파싱 | `lib/sessions.ts`, `lib/session-extras.ts`, `app/components/session-log-shared.ts` |
| 트리 구성 | `app/components/SessionTraceV2View.tsx`(`buildTrace` / `makeNode` / 부모 매칭 루프) |
| 행 렌더 | `SessionTraceV2View.tsx`(`SpanRow`) |
| 상세 패널 | `SessionTraceV2View.tsx`(`SpanDetail` / `SpawnMetaRow`) |
| 라벨 헬퍼 | `SessionTraceV2View.tsx`(`toolLabel` / `subagentChipLabel` / `spawnMeta`) |
| 도구 카탈로그 | `docs/internals/session-jsonl-spec.md` §7 |
