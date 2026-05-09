/**
 * 티켓 워크플로우의 상태. 상태 머신 전이는 lib/ticket-store.ts의
 * ALLOWED_TRANSITIONS가 권위. CANCELLED는 어느 상태에서나 단방향 종료.
 */
export type TicketStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "REVIEW"
  | "DONE"
  | "CANCELLED";

/** 티켓 우선순위. 보드 정렬과 알림 임계값에 사용. */
export type TicketPriority = "low" | "medium" | "high";

/** 영속화된 티켓 한 건. tickets/<id>.json의 최상위 객체. */
export type Ticket = {
  /** ULID 또는 사용자 지정 슬러그. 파일명과 일치. */
  id: string;
  /** 사용자에게 표시되는 한 줄 요약. 1~120자. */
  title: string;
  /** 담당 에이전트 슬러그. 미지정 시 라우팅에서 결정. */
  agent?: string;
  /** 무엇을, 왜 해야 하는지 한 단락 이상의 설명. */
  goal: string;
  /** 작업 배경/맥락(선택). 마크다운 허용. */
  background?: string;
  /** 작업이 만족해야 하는 요구사항 목록. 순서 의미 없음. */
  requirements: string[];
  /** 완료 판정 기준. 모두 충족해야 REVIEW로 보낼 수 있다는 약속(소프트). */
  acceptance_criteria: string[];
  /** 참고 링크/파일 경로(선택). UI에서 클릭 가능하게 렌더. */
  references?: string[];
  /** 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPriority;
  /** 현재 워크플로우 상태. 전이 규칙은 ticket-store.ts. */
  status: TicketStatus;
  /** 차단 여부. true면 IN_PROGRESS에서만 의미가 있다 (Web Push 트리거). */
  blocked: boolean;
  /** 차단 사유. blocked가 true일 때만 의미가 있다. */
  blockedReason?: string;
  /** ISO 8601 생성 시각. 보드 정렬 보조. */
  created_at: string;
  /** ISO 8601 마지막 수정 시각. 변경 시 자동 갱신. */
  updated_at: string;
};

/**
 * 티켓 생성 입력. 서버에서 id/타임스탬프/초기 상태를 채워준다.
 * id를 직접 지정하면 그 값을 그대로 사용 (idempotent 임포트용).
 */
export type TicketDraft = Omit<
  Ticket,
  "id" | "status" | "blocked" | "created_at" | "updated_at"
> & {
  /** 명시적으로 id를 고정하고 싶을 때만. 미지정 시 서버가 생성. */
  id?: string;
  /** 초기 상태 override. 미지정 시 OPEN. */
  status?: TicketStatus;
  /** 초기 blocked 값 override. 미지정 시 false. */
  blocked?: boolean;
};

/** ~/.claude 아래의 한 항목(CLAUDE.md, agent, skill 등) 한 건. */
export type ContextEntry = {
  /** 표시용 이름 (파일명에서 확장자 제거). */
  name: string;
  /** 원본 파일 절대 경로. */
  path: string;
  /** 파일 본문 텍스트. 마크다운 그대로. */
  body: string;
};

/**
 * 한 프로젝트의 ~/.claude 아래 컨텍스트 스냅샷.
 * Context API의 응답 형태이기도 하다.
 */
export type ClaudeContext = {
  /** .claude 디렉토리 절대 경로. */
  projectRoot: string;
  /** CLAUDE.md 한 건. 없으면 null. */
  claudeMd: ContextEntry | null;
  /** agents/*.md 모음. 정렬 기준은 파일명. */
  agents: ContextEntry[];
  /** skills/*.md 모음. 정렬 기준은 파일명. */
  skills: ContextEntry[];
  /** settings.json (Rule 등). 미존재 시 null. */
  rules: {
    /** settings.json의 permissions 키 원본. 형태 검증 안 함. */
    permissions?: unknown;
    /** settings.json의 hooks 키 원본. 형태 검증 안 함. */
    hooks?: unknown;
    /** settings.json 전체 파싱 결과 (raw). */
    raw: unknown;
    /** settings.json 원본 절대 경로. UI 표시용. */
    path: string;
    /** settings.json 원본 텍스트. UI 모달 표시용. */
    body: string;
  } | null;
};

/** 사용자가 등록한 다중 프로젝트 한 건. tickets/.projects.json에 저장. */
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

/** Claude Code 세션 한 건. ~/.claude/projects/<encoded>/<id>.jsonl 기반. */
export type Session = {
  /** 세션 ID. jsonl 파일명에서 확장자 제거한 값. */
  id: string;
  /** 세션이 시작된 작업 디렉토리. 프로젝트 매칭(prefix)에 사용. */
  cwd: string;
  /** 세션 시작 시각 ISO 8601. */
  startedAt: string;
  /** 세션 활성 상태. 최근 N분 내 갱신 여부 등으로 판정. */
  state: "active" | "idle";
};

/**
 * SSE로 브로드캐스트되는 티켓 이벤트.
 * 클라이언트는 setQueryData로 캐시를 머지 (refetch 트리거 아님).
 */
export type TicketEvent =
  | { type: "ticket.created"; ticket: Ticket }
  | { type: "ticket.updated"; ticket: Ticket; previous: Ticket }
  | { type: "ticket.deleted"; id: string };
