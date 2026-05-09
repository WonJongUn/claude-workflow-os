export type TicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "REVIEW"
  | "DONE"
  | "CANCELLED";

export type TicketPriority = "low" | "medium" | "high";

export type Ticket = {
  id: string;
  title: string;
  agent?: string;
  goal: string;
  background?: string;
  requirements: string[];
  acceptance_criteria: string[];
  references?: string[];
  priority: TicketPriority;
  status: TicketStatus;
  blocked: boolean;
  blockedReason?: string;
  created_at: string;
  updated_at: string;
};

export type TicketDraft = Omit<
  Ticket,
  "id" | "status" | "blocked" | "created_at" | "updated_at"
> & {
  id?: string;
  status?: TicketStatus;
  blocked?: boolean;
};

export type ContextEntry = {
  name: string;
  path: string;
  body: string;
};

export type ClaudeContext = {
  projectRoot: string;
  claudeMd: ContextEntry | null;
  agents: ContextEntry[];
  skills: ContextEntry[];
  rules: {
    permissions?: unknown;
    hooks?: unknown;
    raw: unknown;
    /** settings.json 원본 절대 경로. UI 표시용. */
    path: string;
    /** settings.json 원본 텍스트. UI 모달 표시용. */
    body: string;
  } | null;
};

export type Project = {
  /** 프로젝트 식별자. "ALL"은 글로벌 전체 프로젝트(예약). */
  id: string;
  /** 사용자에게 표시되는 이름. */
  name: string;
  /** .claude 디렉토리 절대 경로 (컨텍스트 로딩에 사용). */
  claudeRoot: string;
  /**
   * 사용자가 Claude Code를 띄우는 작업 디렉토리 (세션 매칭에 사용).
   * 미지정 시 claudeRoot의 부모(또는 claudeRoot가 .claude로 끝나지 않으면 자기 자신)를 사용한다.
   * claudeRoot와 workDir이 다른 경우(예: 도구는 서브프로젝트, 작업은 모노레포 루트)에 직접 설정.
   */
  workDir?: string;
};

export type Session = {
  id: string;
  cwd: string;
  startedAt: string;
  state: "active" | "idle";
};

export type TicketEvent =
  | { type: "ticket.created"; ticket: Ticket }
  | { type: "ticket.updated"; ticket: Ticket; previous: Ticket }
  | { type: "ticket.deleted"; id: string };
