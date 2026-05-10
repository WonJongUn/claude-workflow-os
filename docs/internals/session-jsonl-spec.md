# Claude Code Session JSONL — 스키마 분석 (실측 기반)

> 이 문서는 우리 레포가 **실제 디스크의 jsonl을 보고** 정리한 스펙이다.
> Anthropic 공식 문서가 다루지 않는 내부 필드까지 포함하므로, 새 Claude Code
> 버전이 나오면 검증 필요. 측정 시점 버전: `2.1.138` (jsonl `version` 필드 기준).
> 샘플 출처: `~/.claude/projects/-Users-…-claude-workflow-os/*.jsonl`

## 0. 왜 이 문서가 필요한가

세션/서브에이전트 분석 코드(`lib/sessions.ts`, `lib/session-tasks.ts`,
`lib/session-watcher.ts`, `app/components/SessionTrace*.tsx`)가
스키마 가정을 패치마다 다르게 해서 정합성 구멍이 누적됐다.
대표 사례:

- **TeamCreate spawn 서브에이전트가 트레이스에서 고아**:
  meta.json에 `description`이 없고 `agentType`만 있는데 매칭은 description 의존이었음.
- **태스크가 영원히 pending**:
  팀 lead가 메인에서 `TaskCreate`, 팀원이 sidechain에서 `TaskUpdate`(completed)인데
  replay가 sidechain을 통째로 skip.
- **알림 클릭 시 `/sessions/agent-xxx`로 라우팅**:
  watcher가 서브에이전트 jsonl까지 tail하고 `path.basename`으로 sessionId를 만들어서
  `agent-<id>` 가 sessionId가 됨.
- **서브에이전트의 `promptId`가 메인의 Agent tool_use가 없는 턴을 가리킴**:
  TeamCreate의 idle 팀원 wake-up 시 새 `agent-<id>.jsonl`이 lead의 *현재* promptId로
  attribute 됨. promptId만으로 부모 Agent를 못 찾는다.

이 문서가 단일 진실 원천이 되어야 한다. 새 파서/뷰는 이 문서의 카테고리·관계를 따른다.

---

## 1. 파일 시스템 레이아웃

```
~/.claude/projects/<encoded-cwd>/
  <sessionId>.jsonl                    # 메인 세션 (1세션 1파일)
  <sessionId>/
    subagents/
      agent-<agentId>.jsonl            # 서브에이전트 (Agent tool 또는 TeamCreate 팀원)
      agent-<agentId>.meta.json        # 서브에이전트 메타 (사이드카)
```

- `<encoded-cwd>`: 작업 디렉토리 절대 경로의 `/`를 `-`로 치환.
- `<sessionId>` / `<agentId>`: 둘 다 임의 문자열. sessionId는 UUIDv4 패턴, agentId는 더 짧은 hex.
- **메인 jsonl과 서브에이전트 jsonl은 별개 파일**이지만 *논리적으로 한 세션*이다.
  파서는 둘을 합쳐서(`readSessionBundle`) 시간순으로 다룬다.
- **합쳐진 본문은 line 순서가 시간순이 아니다** — `ts` 기준 정렬 필수.

### 1.1 메타 사이드카 (`agent-<id>.meta.json`)

```json
// Agent tool로 spawn된 일반 서브에이전트
{"agentType": "Explore", "description": "Explore ticket store and API"}

// TeamCreate 팀원 (description 없음)
{"agentType": "backend"}
```

| 필드 | 의미 | 비고 |
|---|---|---|
| `agentType` | 서브에이전트 분류. Agent의 `subagent_type` *또는* TeamCreate의 `name` | 항상 존재 |
| `description` | Agent 호출 시의 `description` 인자 | TeamCreate 팀원에는 없음 ⚠️ |

→ **부모 Agent와의 매칭 키**가 둘로 나뉨 (§7 참고).

---

## 2. 공통 envelope 필드 (대부분의 라인)

| 필드 | 타입 | 누가 갖나 | 의미 |
|---|---|---|---|
| `uuid` | string | `user`/`assistant`/`attachment`/`system` | 라인 식별자. 다른 라인의 `parentUuid`로 참조됨 |
| `parentUuid` | string \| null | 위와 동일 | 직전 논리 라인의 `uuid`. 첫 라인이거나 새 turn 시작이면 null. |
| `timestamp` | ISO8601 string | 거의 모두 | 시간순 정렬의 단일 기준 |
| `sessionId` | string | 모든 라인 | 메인 세션 id. 서브에이전트 라인도 같은 메인 sessionId를 갖는다 (file 위치만 다름) |
| `type` | string | 모든 라인 | 라인 카테고리 (§3). |
| `isSidechain` | boolean | 메시지/attachment 라인 | true면 서브에이전트 jsonl 출신. 메인에서는 false 또는 누락. |
| `cwd` | string | 메시지/attachment 라인 | 그 시점 작업 디렉토리 |
| `version` | string | 메시지/attachment 라인 | Claude Code 버전 (`2.1.138` 등) |
| `gitBranch` | string | 메시지/attachment 라인 | 그 시점 git 브랜치 |
| `slug` | string | 메시지/attachment 라인 (선택) | 플랜 파일/세션 라벨 등 |
| `userType` | `"external"` | 메시지/attachment 라인 | 정체 불명, 항상 external 관측 |
| `entrypoint` | `"cli"` | 메시지/attachment 라인 | 진입점 종류 |
| `permissionMode` | `"default"`/`"acceptEdits"`/`"bypassPermissions"` | user 라인(가끔), 별도 `permission-mode` 라인 | |
| `teamName` | string | 팀 컨텍스트의 메시지 라인 | TeamCreate 활성 시. 메인에도 sidechain에도 붙음 |
| `promptId` | string | **user 라인**에만 명시 | 같은 turn 식별자. assistant 라인은 `null` (직전 user의 promptId 상속) |
| `requestId` | string | assistant 메시지 | API 요청 식별자 |

> **핵심**: `parentUuid`는 라인 단위 체인이고, `promptId`는 turn 단위 식별자다.
> 둘은 다른 추상화로, parentUuid 체인을 따라 올라가다 보면 같은 promptId가 유지된다 (메인 thread).

---

## 3. 라인 카테고리 (`type` 필드)

실측 빈도순 (한 메인 jsonl 기준):

| `type` | 의미 | sidechain에서도 출현? | 설명 |
|---|---|---|---|
| `assistant` | 모델 응답 한 덩어리 | ✅ | thinking / text / tool_use 블록 N개를 `message.content` 배열로 |
| `user` | 사용자 입력 *또는* tool_result | ✅ | 첫 입력은 `message.content`가 string, 이후 멀티블록 또는 tool_result 배열 |
| `attachment` | 시스템 부속 정보 | ✅ (드물게) | §4.3 |
| `system` | 시스템 이벤트 | (확인 안 됨) | turn 종료 메타(`turn_duration`) 등 |
| `ai-title` | 세션 자동 제목 | ❌ | 메타 라인. envelope 필드 거의 없음 |
| `agent-name` | 세션 displayName | ❌ | 메타 라인 |
| `last-prompt` | 마지막 사용자 프롬프트 요약 | ❌ | resume 시 thumbnail |
| `permission-mode` | 권한 모드 변경 기록 | ❌ | |
| `queue-operation` | enqueue/dequeue 이벤트 | ❌ | 사용자가 이미 입력한 다음 프롬프트가 큐잉되었을 때 |
| `file-history-snapshot` | 파일 백업 스냅샷 | ❌ | Claude Code의 변경 추적 |

> 메타 라인(소문자 하이픈 type)은 envelope 필드 거의 없이 자체 필드만 갖는다. 트레이스/태스크 분석에서 무시해도 안전.

---

## 4. 핵심 라인 상세

### 4.1 `user` 라인

세 가지 변종이 있다 — `message.content`의 형태로 구분:

#### 4.1.1 사용자 입력 (string content)

```json
{
  "type": "user",
  "promptId": "4a7b3fa2-...",
  "parentUuid": null,
  "message": { "role": "user", "content": "프롬프트 텍스트" },
  "uuid": "...",
  "timestamp": "...",
  "sessionId": "...",
  "isSidechain": false
}
```

- `parentUuid: null` 가 **새 turn의 시작점**이다 (메인 thread의 경우).
- `promptId`는 user 라인에만 명시. assistant 라인은 직전 user의 promptId를 *상속*해 attribute한다.

#### 4.1.2 사용자 입력 (배열 content — 텍스트 + 이미지 등)

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "..." } }
    ]
  },
  "imagePasteIds": [1]
}
```

- `imagePasteIds`는 사용자가 paste한 이미지의 클라이언트 식별자.
- **이미지 첨부는 별도 turn이 아니다.** 같은 user 라인의 content 배열에 나란히 들어간다.

#### 4.1.3 tool_result (assistant의 tool_use에 대한 응답)

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_013daEJzN26kdP5d4Z672GWr",
        "content": "도구 출력 텍스트 (생략 가능)",
        "is_error": false
      }
    ]
  },
  "toolUseResult": { "stdout": "...", "stderr": "...", "interrupted": false, "isImage": false, "noOutputExpected": false },
  "sourceToolAssistantUUID": "1be5308a-...",
  "promptId": "587f84ec-..."
}
```

- `tool_use_id`로 같은 라인 안의 어떤 assistant `tool_use` 블록과 짝이 맞는지 결정.
- `toolUseResult`는 envelope 레벨 필드로, 도구별 구조화된 결과(Bash는 stdout/stderr 등). 표시용.
- `sourceToolAssistantUUID`는 tool_use를 발행한 assistant 라인의 `uuid` (parentUuid와 동일 값일 때가 많음).

> **주의**: tool_result도 `type: "user"` + `role: "user"`다. 사용자 입력과 구별하려면
> `message.content[0].type === "tool_result"` 또는 `toolUseResult` 필드 존재로 판별.

### 4.2 `assistant` 라인

```json
{
  "type": "assistant",
  "parentUuid": "직전 user 라인의 uuid",
  "isSidechain": false,
  "message": {
    "model": "claude-opus-4-7",
    "id": "msg_...",
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "thinking", "thinking": "...", "signature": "..." },
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "toolu_...", "name": "Bash", "input": { ... }, "caller": { "type": "direct" } }
    ],
    "stop_reason": "tool_use",
    "usage": { ... }
  },
  "requestId": "req_..."
}
```

content 블록 종류:

| `type` | 필드 | 설명 |
|---|---|---|
| `thinking` | `thinking`, `signature` | extended thinking 본문. UI에서 접힘 처리 권장 |
| `text` | `text` | 일반 응답 텍스트 |
| `tool_use` | `id`, `name`, `input`, `caller` | 도구 호출. id는 후속 tool_result와 짝 |

- 한 assistant 라인에 여러 종류의 블록이 함께 올 수 있다 (`thinking + text + tool_use`).
- `name` 값은 §7의 도구 카탈로그 참고.
- `caller.type`은 보통 `"direct"`. 다른 값 관측되면 추가 분석 필요.

### 4.3 `attachment` 라인

`message`가 없고 `attachment` 필드를 갖는다. 모델 응답이 아닌 *시스템이 컨텍스트에 끼워 넣은* 정보.

| `attachment.type` | 의미 |
|---|---|
| `task_reminder` | 사용자에게 task 갱신 리마인드 (system-reminder 형태) |
| `queued_command` | 사용자가 입력해둔 다음 프롬프트가 도착(처리 전 큐잉됨) |
| `edited_text_file` | 사용자/도구가 외부에서 파일을 편집한 사실 통지 (filename, snippet 포함) |
| `deferred_tools_delta` | 새 도구가 컨텍스트에 추가됨 (`addedNames`/`removedNames`) |
| `mcp_instructions_delta` | MCP 서버가 지시문을 새로 등록 |
| `skill_listing` | 사용 가능한 skill 목록 갱신 |
| `plan_mode` | 플랜 모드 진입 알림 (`planFilePath` 등) |
| `plan_mode_exit` | 플랜 모드 종료 |

- 트레이스/태스크 분석에서는 보통 무시해도 됨. 단 `edited_text_file`은 변경 추적에 유용.

### 4.4 `system` 라인

```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 454035,
  "messageCount": 55,
  "isMeta": false
}
```

- `subtype`이 분기 키. 알려진 값: `turn_duration`. 다른 값은 추가 발견 시 표 갱신.

---

## 5. 라인 간 관계

### 5.1 `parentUuid` 체인

- 메인 thread에서: 새 user 입력은 `parentUuid: null`. 그 뒤 assistant/tool_result는 직전 라인의 uuid를 가리킴 — chain.
- 서브에이전트 thread에서: 첫 라인(서브에이전트 입력)도 `parentUuid: null`. 그 뒤 자기 thread 안에서 chain.
- **체인은 같은 thread 안에서만 유효**. 서브에이전트 라인의 parentUuid가 메인 라인을 가리키지 않는다.
- chain은 *논리적 부모*이지, 시간순 직전 라인이 아닐 수 있다 (멀티블록 이슈).

### 5.2 `promptId` (turn 식별자)

- user 라인에만 명시. 같은 promptId의 후속 assistant/tool_result는 그 user의 promptId 상속.
- 메인 thread의 *한 turn* = 한 promptId 구간.
- ⚠️ **서브에이전트 jsonl의 첫 라인 promptId는 메인 lead의 *현재* promptId를 가져온다.**
  TeamCreate가 idle 팀원을 wake할 때 새 `agent-<id>.jsonl`을 만들고 lead의 promptId로 attribute.
  → 그 promptId 시점에 lead가 Agent tool_use를 발행하지 않았을 수 있음 → "고아" 발생.

### 5.3 tool_use ↔ tool_result

- `tool_use_id` 필드로 1:1 매칭. 같은 라인 안에서 매칭하지 않고 *후속 user 라인*에서 매칭.
- 도구 결과의 `is_error`로 실패 표시.
- 일부 도구는 `toolUseResult` envelope에 구조화된 결과 추가 (Bash의 stdout/stderr 등).

### 5.4 sidechain ↔ Agent tool_use (서브에이전트 ↔ 부모)

- 서브에이전트 jsonl 첫 라인에는 `agentId` 필드가 있고 그 jsonl의 모든 라인이 같은 agentId를 갖는다.
- 부모 Agent tool_use를 찾는 매칭 키는 **두 개의 fallback 사슬**이 필요:

| 우선 | 키 | 적용 케이스 |
|---|---|---|
| 1 | `meta.description == input.description` | 일반 Agent 호출 (Explore 등) |
| 2 | `meta.agentType == input.name` | TeamCreate 팀원 (description 없음) |
| 3 | 같은 promptId에 Agent tool_use가 단 하나면 그것 | disambiguate 불필요 케이스 |
| 4 | (aspirational) promptId 무시하고 `meta.agentType == input.name` 전역 매칭 | TeamCreate idle 팀원 wake-up |

> 4단계는 misattribution 위험이 있으므로 신중하게. 같은 팀원이 재spawn되어 새 agentId를 받는 경우 가장 가까운 (이전 timestamp) Agent로 묶는 등의 추가 규칙 필요.

---

## 6. 서브에이전트 jsonl 특이점

### 6.1 메인과 다른 envelope 필드

| 필드 | 의미 |
|---|---|
| `agentId` | 서브에이전트 식별자. 파일명(`agent-<id>.jsonl`)과 동일 |
| `attributionAgent` | (관측되지만 의미 미확정 — 추가 조사 필요) |
| `sourceToolAssistantUUID` | tool_result일 때 발행한 assistant uuid (메인과 동일 의미) |

### 6.2 첫 라인의 형태

```json
{
  "parentUuid": null,
  "isSidechain": true,
  "agentId": "a1f777a8db8ab8738",
  "promptId": "<lead의 spawn 시점 promptId>",
  "type": "user",
  "message": {
    "role": "user",
    "content": "<teammate-message teammate_id=\"team-lead\" summary=\"…\">…</teammate-message>"
  }
}
```

- TeamCreate는 `<teammate-message>` XML 래퍼로 첫 메시지를 감싼다. `summary` 속성이
  Agent tool_use input의 `description`과 같다 — 매칭에 활용 가능.
- 일반 Agent spawn은 단순 문자열 또는 멀티블록 content.

---

## 7. 도구 카탈로그 (Claude Code v2.1+)

공식 문서: <https://code.claude.com/docs/en/tools-reference>. jsonl `assistant.message.content[*].type === "tool_use"`의 `name` 필드 값이 도구 이름이다.

### 7.1 카테고리별

| 그룹 | 도구 |
|---|---|
| 파일 IO | `Read`, `Write`, `Edit`, `NotebookEdit` |
| 검색 | `Glob`, `Grep`, `LSP` |
| 셸 | `Bash`, `PowerShell`, `Monitor` |
| 웹 | `WebFetch`, `WebSearch` |
| 태스크 (인터랙티브) | `TaskCreate`, `TaskGet`, `TaskList`, `TaskUpdate`, `TaskStop`, `TaskOutput`(deprecated) |
| 태스크 (헤드리스) | `TodoWrite` |
| 서브에이전트 | `Agent`, `SendMessage` |
| 팀 (실험) | `TeamCreate`, `TeamDelete` |
| 스케줄 | `CronCreate`, `CronList`, `CronDelete` |
| 워크트리 | `EnterWorktree`, `ExitWorktree` |
| 플랜 모드 | `EnterPlanMode`, `ExitPlanMode` |
| MCP | `ListMcpResourcesTool`, `ReadMcpResourceTool`, `mcp__<server>__<tool>` (동적) |
| 스킬 | `Skill` |
| 사용자 상호작용 | `AskUserQuestion`, `ShareOnboardingGuide` |
| 도구 검색 | `ToolSearch` |

### 7.2 트레이스/태스크 분석에 영향이 큰 도구

- **`Agent`**: 서브에이전트 spawn. `input.subagent_type`/`name`/`description`/`team_name`이 식별 핵심.
- **`TeamCreate`**: 팀 + 팀원들 spawn. `input.team_name`/`agent_type`.
- **`SendMessage`**: 팀원에 메시지 전달, 또는 idle 서브에이전트 resume.
  → idle 팀원 wake-up이 새 `agent-<id>.jsonl`을 만드는 트리거일 가능성 높음 (검증 필요).
- **`TaskCreate`/`TaskUpdate`/`TaskUpdate`**: jsonl input에 `taskId` 미포함 (TaskCreate는 자동 부여).
  세션 단위 카운터로 합성. **TeamCreate의 공유 태스크 리스트는 lead가 만들고 팀원이 갱신**하는 패턴이라
  메인+sidechain을 동기화해야 정확한 상태가 나온다.
- **`Skill`**: `input.skill` 이 스킬 이름. detail 패널에서 노출 권장.
- **`ToolSearch`**: 컨텍스트에 deferred 도구를 추가. 결과로 후속 라인에 `attachment/deferred_tools_delta`가 따라옴.
- **`ExitPlanMode`**: 플랜 모드 탈출. `input.plan` 에 마크다운 플랜 본문이 통째로 들어 있다. 사용자 승인 결과는 jsonl에 별도 라인으로 남지 않음 — 후속 turn의 흐름으로만 추론 가능.

### 7.3 세션 상세 — 팀/플랜 탭 데이터 스펙

세션 상세의 `팀`/`플랜` 탭은 위 두 도구의 `tool_use` 블록 input에서 직접 추출한다.
파서는 새로 만들지 않고 `parseSessionLog`가 만든 `ParsedEvent` 위에서 필터·매핑한다.

#### 추출 절차 (양 탭 공통)

```ts
events
  .filter(ev => ev.toolName === "TeamCreate" /* or "ExitPlanMode" */)
  .map(ev => {
    const block = normalizeContent(ev.raw.message?.content)
      .find(b => b.type === "tool_use");
    const input = (block as { input?: unknown }).input as Record<string, unknown>;
    return { ts: ev.ts, sidechain: ev.sidechain, ...pick(input) };
  })
  .sort((a, b) => a.ts - b.ts);
```

- `events`는 `readSessionBundle` 합본이라 메인+서브에이전트가 섞여 있다. ts 정렬 필수 (§E6).
- `ev.sidechain` 은 `raw.isSidechain` 그대로. UI에서는 violet 가이드 + `SidechainBadge` 로 구분.
- 같은 도구가 여러 번 호출되면 발생한 만큼 모두 표시한다. dedup 금지 (의미 손실).

#### 팀 그래프 매칭 규칙

팀 탭은 단순 리스트가 아니라 **노드 그래프**다. lead(=TeamCreate)와 멤버(=Agent)를 묶는 키는 **`input.team_name`**.

```
TeamCreate.input.team_name === Agent.input.team_name  ⇒ 같은 팀
```

- TeamCreate가 없는 `Agent`는 **synthetic 팀**으로 합성(점선 테두리). 메인 세션이 다른 곳에서 시작된 팀에 합류한 경우.
- `Agent.input.team_name`이 없는 호출은 일반 서브에이전트 spawn — 팀 그래프에서 제외.
- 멤버 노드는 `Agent.input.name` (팀 안 별명) → `subagent_type` (베이스 타입) → `description` (한 줄 임무) 순으로 표시.
- 매칭은 envelope의 `teamName` 필드가 아니라 *항상* tool_use input의 team_name. envelope는 *현재 활성 팀*을 가리키는 컨텍스트라 lead 식별과 어긋날 수 있다.

#### TeamCreate `input` 필드

| 필드 | 타입 | 의미 | 비고 |
|---|---|---|---|
| `team_name` | `string` | 팀의 식별자(슬러그). 후속 `SendMessage`의 라우팅 키. | 메인 envelope의 `teamName`과도 중복 기록될 수 있음. |
| `agent_type` | `string` | 팀 lead 에이전트의 타입(예: `team-lead`). | 팀원의 타입은 여기 없음 — `Agent` 호출이나 `agent-<id>.meta.json` 참조. |
| `description` | `string` | 팀의 한 줄 목적. | 팀이 idle wake-up될 때 매칭 키로 쓰이지 않음 — 자유 텍스트. |
| `members` (관측 시) | `array` | 일부 버전에서 팀원 list가 함께 들어올 수 있음. | 현 버전(2.1.138) 샘플에서는 없음. 추가 시 옵셔널로 매핑. |

샘플:

```json
{
  "type": "tool_use",
  "name": "TeamCreate",
  "input": {
    "team_name": "ticket-automation",
    "agent_type": "team-lead",
    "description": "칸반 티켓 자동화: 백그라운드 워처 + 스킬 + 보드 UI + 사운드 알림"
  }
}
```

- 결과(`tool_result`)는 보통 사람이 읽을 한 줄 (팀 생성 확인). 패널은 결과를 표시하지 않는다 — 입력만으로 충분.
- TeamCreate가 만든 팀원의 첫 jsonl은 `subagents/agent-<id>.jsonl`. 부모 매칭은 `agentType`→`input.agent_type`(lead)이 아니라 §5.4의 fallback 체인을 따른다.

#### ExitPlanMode `input` 필드

| 필드 | 타입 | 의미 | 비고 |
|---|---|---|---|
| `plan` | `string` | 마크다운 플랜 본문. 헤딩/리스트/코드블록/테이블 모두 가능. | 길이 제한 없음 — 패널은 그대로 `SessionMarkdown`으로 렌더. |

플랜 본문은 input에만 있지만 Claude Code는 **세션 envelope의 `slug`** 를 키로 `~/.claude/plans/<slug>.md` 파일에도 같은 본문을 보존한다. 패널 카드 타이틀에 이 경로를 옅게 표시해 사용자가 외부에서 같은 파일을 열어볼 수 있게 한다 (slug가 없는 케이스 대비 옵셔널).

샘플 (앞부분):

```json
{
  "type": "tool_use",
  "name": "ExitPlanMode",
  "input": {
    "plan": "# 칸반 자동화: 티켓 → 자동 작업 → 칸반 동기화\n\n## Context\n…"
  }
}
```

- 사용자 승인/반려 결과는 jsonl에 도구 result 텍스트로만 남고 별도 status 필드는 없음.
- 한 세션에서 여러 번 호출될 수 있다 (반려 후 재제안). 시간순으로 누적 표시.
- `plan`이 빈 문자열인 케이스도 가능 (모델이 빈 호출). 패널은 "(빈 플랜)" placeholder.

---

## 8. 엣지 케이스 (실측·검증된 정합성 함정)

| # | 증상 | 원인 | 우리 코드의 대처 |
|---|---|---|---|
| E1 | TeamCreate 서브에이전트가 트레이스 고아 | meta.json에 description 없음, 부모 매칭 1단만 시도 | §5.4의 fallback 2단 추가됨 (`buildSubagentParentMap`) |
| E2 | 같은 turn에 Agent 2개 spawn 시 disambiguate 실패 | 후보 2개에 description 둘 다 없음 | meta.agentType→input.name 매칭으로 해결 |
| E3 | 서브에이전트 promptId가 lead의 다른 턴(Agent 호출 없는)을 가리킴 | TeamCreate idle wake-up이 새 agentId + lead 현재 promptId로 jsonl 생성 | 미해결. fallback 4단 검토 필요 |
| E4 | TaskUpdate(completed) 무시되어 영원히 pending | replay가 sidechain 전체 skip | sidechain TaskUpdate만 통과시키고 `byId.get` 게이트로 자체 todo는 격리 (`session-tasks.ts`) |
| E5 | 알림 클릭 시 `/sessions/agent-xxx`로 라우팅 | watcher가 `subagents/*.jsonl` 도 tail | 패스에 `/subagents/` 포함 시 skip (`session-watcher.ts`) |
| E6 | 합본 본문이 시간순이 아님 | 메인 jsonl 뒤에 서브에이전트 jsonl을 file 순으로 concat | 모든 파서가 ts 정렬 후 처리 (`parseLog`/`parseConversation`/`buildTrace`) |
| E7 | 이미지 paste 후 별도 turn처럼 보임 | content 배열의 image+text를 분리 렌더하는 뷰가 있을 수 있음 | 단일 user 라인으로 처리해야. 이미지는 base64라 토스트/요약에 안 보이게 |
| E8 | 서브에이전트 안의 thinking·long output | content 블록 길이가 매우 길 수 있음 (예: 본 문서의 toolUseResult.stdout) | 표시 시 truncate 필수, 상세 패널에서만 펼침 |
| E9 | 멀티블록 한 assistant 라인의 부분 매칭 | thinking + text + tool_use가 한 라인에 — span 분리 시 같은 uuid를 공유 | span id를 합성 키(`<uuid>:<blockIndex>`) 또는 첫 블록만 대표로 |
| E10 | `caller.type` 비-direct 케이스 | (관측 안 됨, 가설) skill 실행 안의 도구 호출에서 다른 값일 가능성 | 추가 데이터 수집 필요 |
| E11 | TaskCreate 알림 `#N` 이 실제 id와 어긋나 알림 클릭 시 카드 강조 실패 | TaskCreate input엔 taskId 없음. 우리가 1..N 합성했지만 Claude Code 2.1+는 *harness 전역 시퀀스*를 envelope `toolUseResult.task.id` 로 부여 (예: 한 세션 4건이 18·19·20·21) | tool_use_id를 키로 보류 → 같은/후속 라인 tool_result의 `toolUseResult.task.id` 로 확정 (`session-tasks.ts` `extractTaskResultId`, watcher `pendingCreate`) |

---

## 9. 우리 코드의 가정 점검 (TODO)

다음 코드 경로별로 이 문서와 어긋나는 가정이 있는지 다시 검토할 필요:

- [ ] `lib/sessions.ts:readSessionBundle` — 메인+서브에이전트 합본 시 ts 정렬 보장 여부
- [ ] `lib/sessions.ts:buildSubagentParentMap` — fallback 4단(전역 매칭) 추가 여부 결정
- [ ] `lib/session-extras.ts` — content 블록 멀티타입 처리, attachment 라인 무시 정책
- [ ] `lib/session-watcher.ts` — `subagents/` skip은 적용됨. tool_use 카운터(`createCounter`) 정합성
- [ ] `lib/session-tasks.ts` — sidechain TaskUpdate 통과는 적용됨. TodoWrite vs TaskCreate 우선순위 검증
- [ ] `app/components/SessionTraceV2View.tsx` — span의 합성 id 정책 (현재 raw uuid 그대로 → 멀티블록 충돌 가능)
- [ ] `app/components/SessionLogView.tsx` — 라인 카테고리 분기 누락 여부 (특히 attachment 종류)

---

## 10. 측정/검증 방법

```bash
# 라인 type 분포
python3 -c '
import json,sys
from collections import Counter
c=Counter()
for l in open(sys.argv[1]):
    try: o=json.loads(l)
    except: continue
    c[(o.get("type"),
       o.get("message",{}).get("role") if isinstance(o.get("message"),dict) else None,
       (o.get("attachment") or {}).get("type") if isinstance(o.get("attachment"),dict) else None,
       bool(o.get("isSidechain"))
      )]+=1
for k,n in c.most_common(): print(n,k)
' <session.jsonl>

# 도구 사용 분포
python3 -c '
import json,sys
from collections import Counter
c=Counter()
for l in open(sys.argv[1]):
    try: o=json.loads(l)
    except: continue
    msg=o.get("message",{})
    for b in msg.get("content",[]) if isinstance(msg.get("content"),list) else []:
        if isinstance(b,dict) and b.get("type")=="tool_use": c[b.get("name")]+=1
for k,n in c.most_common(): print(n,k)
' <session.jsonl>

# 부모 매칭 검증 (서브에이전트별 매칭 결과)
# → 본 문서의 §5.4 알고리즘을 그대로 시뮬레이션해 ORPHAN 빈도 측정
```

새 Claude Code 버전(`version` 필드)으로 jsonl이 갱신될 때마다 이 문서를 다시 검증하고
관측된 새 라인 type/필드를 §3, §4에 추가한다.
