/**
 * SessionLogView와 분리된 무거운 뷰들(Trace/SwimLane/Charts)이 공유하는
 * 타입과 순수 헬퍼. 이 파일은 React 컴포넌트를 export하지 않아 순환 의존이 없다.
 *
 * 분리 이유: Trace/SwimLane/Charts를 React.lazy로 동적 import하려면 별도 모듈로 떼야 하고,
 * 그 모듈들이 SessionLogView에서 import하면 순환이 생기므로 헬퍼만 따로 모은다.
 */

export type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string }
  | {
      type: "tool_use";
      name?: string;
      input?: unknown;
    }
  | {
      type: "tool_result";
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };

export type RawEvent = {
  type?: string;
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  summary?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    model?: string;
  };
};

export type ParsedEvent = {
  /** 원본 객체 (디버그용). */
  raw: RawEvent;
  /** ISO timestamp (있을 때). */
  timestamp?: string;
  /** epoch ms (정렬·기간 계산). */
  ts?: number;
  /** 이벤트 분류. */
  kind:
    | "user"
    | "assistant"
    | "tool_use"
    | "tool_result"
    | "summary"
    | "system"
    | "other";
  /** 도구 이름 (tool_use). */
  toolName?: string;
  /** 사람이 읽을 한 줄 요약 (절단됨). */
  preview: string;
  /** 절단 없이 보존한 본문. user/assistant text 등에만 채워진다. */
  text?: string;
  /** 모델 (assistant). */
  model?: string;
  /** 사이드채널(서브에이전트) 여부. */
  sidechain?: boolean;
};

export type SessionStats = {
  /** 총 이벤트 수. */
  total: number;
  /** 사용자 메시지 수. */
  user: number;
  /** 어시스턴트 메시지 수. */
  assistant: number;
  /** 도구 호출 수. */
  toolUse: number;
  /** 도구 결과 수. */
  toolResult: number;
  /** 첫·마지막 timestamp (epoch ms). */
  firstTs?: number;
  lastTs?: number;
  /** 사용된 모델 (마지막 어시스턴트 기준). */
  lastModel?: string;
};

export const KIND_LABEL: Record<ParsedEvent["kind"], string> = {
  user: "사용자",
  assistant: "어시스턴트",
  tool_use: "도구",
  tool_result: "결과",
  summary: "요약",
  system: "시스템",
  other: "기타",
};

/**
 * 뱃지 hover 시 띄우는 짧은 설명. 타임라인·트레이스·트레이스 V2·대화 패널이 공유한다.
 * 새 뷰가 같은 종류 뱃지를 그릴 때 이 표만 import해 일관성을 유지한다.
 */
export const KIND_TOOLTIP: Record<ParsedEvent["kind"], string> = {
  user: "사용자가 입력한 메시지(프롬프트). 새 턴의 시작점.",
  assistant: "어시스턴트가 만든 텍스트 응답. 도구 호출 없이 글만 답한 메시지.",
  tool_use:
    "어시스턴트가 도구를 호출한 메시지(Read·Bash·Edit 등). 입력 인자가 함께 기록됨.",
  tool_result:
    "이전 도구 호출의 결과. 호출과 같은 tool_use_id로 매칭됨. is_error=true면 실패.",
  summary: "Claude Code가 자동 생성한 세션 요약 라인.",
  system: "시스템 메시지(설정·환경 알림 등). 보통 상호작용에 영향 없음.",
  other: "분류되지 않은 이벤트. 알 수 없는 type일 때.",
};

/** 트레이스 V2 span 종류별 툴팁. 위 KIND_TOOLTIP과 의미가 겹치지만 turn은 트레이스 V2 전용. */
export const SPAN_KIND_TOOLTIP: Record<
  "turn" | "assistant" | "tool" | "sidechain",
  string
> = {
  turn: "사용자 입력 1회 = 1턴(루트 span). 그 아래에 어시스턴트 응답·도구 호출이 자식으로 묶인다.",
  assistant: KIND_TOOLTIP.assistant,
  tool: "비-사이드체인 도구 호출. tool_use → 매칭된 tool_result로 기간 계산.",
  sidechain:
    "서브에이전트(Task 도구로 띄워진 보조 에이전트)가 호출한 도구. 부모 Task span 아래로 nesting.",
};

/** 사이드체인 라벨 자체에 대한 툴팁. */
export const SIDECHAIN_TOOLTIP =
  "서브에이전트(Task 도구로 띄워진 보조 에이전트)의 메시지.";

/** ContentBlock 배열만 추려낸다. 문자열 content는 빈 배열. */
export function normalizeContent(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (c): c is ContentBlock => typeof c === "object" && c !== null,
  );
}

/** 시각:분:초 (HH:MM:SS) — 타임라인/트레이스 행의 좌측 시각 표시. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** ms를 초/분/시간 단위 한국어 라벨로. */
export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분`;
  const hr = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin === 0 ? `${hr}시간` : `${hr}시간 ${restMin}분`;
}

/** "M/D HH:MM" 짧은 시각 라벨 — Charts 시간대 막대 라벨용. */
export function formatStamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 두 시각의 범위 라벨. */
export function formatRange(start: number, end: number): string {
  return `${formatStamp(start)} ~ ${formatStamp(end)}`;
}

/** 차트 상한을 보기 좋은 수로 올림 (1, 2, 5, 10의 배수). */
export function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const ratio = n / base;
  let nice: number;
  if (ratio <= 1) nice = 1;
  else if (ratio <= 2) nice = 2;
  else if (ratio <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

/** 0부터 max까지 동일 간격 tick 생성. count는 tick 사이 간격 수. */
export function buildTicks(max: number, count: number): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step));
}

/**
 * Edit/MultiEdit/Write 도구 호출의 raw input에서 diff 가능한 변경 블록을 뽑아낸다.
 * 그 외 도구는 빈 배열.
 */
export function extractEditChanges(ev: ParsedEvent): {
  filePath: string;
  changes: (
    | { kind: "edit"; oldText: string; newText: string }
    | { kind: "write"; content: string }
  )[];
} {
  const empty = { filePath: "", changes: [] };
  if (ev.kind !== "tool_use" || !ev.toolName) return empty;
  const block = normalizeContent(ev.raw.message?.content).find(
    (b) => b.type === "tool_use",
  );
  if (!block || block.type !== "tool_use") return empty;
  const input = block.input as Record<string, unknown> | undefined;
  if (!input) return empty;
  const filePath =
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.notebook_path === "string" && input.notebook_path) ||
    "";
  if (ev.toolName === "Edit" || ev.toolName === "NotebookEdit") {
    const oldText =
      typeof input.old_string === "string"
        ? input.old_string
        : typeof input.old_source === "string"
          ? input.old_source
          : "";
    const newText =
      typeof input.new_string === "string"
        ? input.new_string
        : typeof input.new_source === "string"
          ? input.new_source
          : "";
    if (!oldText && !newText) return empty;
    return {
      filePath,
      changes: [{ kind: "edit", oldText, newText }],
    };
  }
  if (ev.toolName === "MultiEdit" && Array.isArray(input.edits)) {
    const changes = (input.edits as unknown[])
      .map((e) => {
        if (!e || typeof e !== "object") return null;
        const o = e as Record<string, unknown>;
        const oldText = typeof o.old_string === "string" ? o.old_string : "";
        const newText = typeof o.new_string === "string" ? o.new_string : "";
        if (!oldText && !newText) return null;
        return { kind: "edit" as const, oldText, newText };
      })
      .filter(
        (x): x is { kind: "edit"; oldText: string; newText: string } => x !== null,
      );
    if (changes.length === 0) return empty;
    return { filePath, changes };
  }
  if (ev.toolName === "Write") {
    const content = typeof input.content === "string" ? input.content : "";
    if (!content) return empty;
    return { filePath, changes: [{ kind: "write", content }] };
  }
  return empty;
}

/** content 배열 안의 tool_use / tool_result 블록의 식별 id를 추출. */
export function extractToolUseId(
  raw: RawEvent,
  blockType: "tool_use" | "tool_result",
): string | null {
  const blocks = normalizeContent(raw.message?.content);
  for (const b of blocks) {
    if (blockType === "tool_use" && b.type === "tool_use") {
      return typeof (b as { id?: unknown }).id === "string"
        ? (b as unknown as { id: string }).id
        : null;
    }
    if (blockType === "tool_result" && b.type === "tool_result") {
      return typeof (b as { tool_use_id?: unknown }).tool_use_id === "string"
        ? (b as unknown as { tool_use_id: string }).tool_use_id
        : null;
    }
  }
  return null;
}
