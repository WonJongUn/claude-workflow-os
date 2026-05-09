import axios from "axios";
import type { ClaudeContext, Project } from "@/lib/types";
import type { DirListing } from "@/lib/fs-browse";

const api = axios.create({
  baseURL: "/api",
  headers: { "content-type": "application/json" },
});

/**
 * 등록된 프로젝트 전체 조회. 첫 항목은 항상 "전체".
 */
export async function fetchProjects(): Promise<Project[]> {
  const { data } = await api.get<Project[]>("/projects");
  return data;
}

/**
 * 새 프로젝트 등록.
 */
export async function createProject(input: {
  name: string;
  claudeRoot: string;
  workDir?: string;
}): Promise<Project> {
  const { data } = await api.post<Project>("/projects", input);
  return data;
}

/**
 * 프로젝트 일부 필드 갱신.
 */
export async function updateProject(
  id: string,
  patch: { name?: string; workDir?: string },
): Promise<Project> {
  const { data } = await api.patch<Project>(`/projects/${id}`, patch);
  return data;
}

/**
 * 프로젝트 삭제. ALL은 서버가 거부.
 */
export async function deleteProject(id: string): Promise<void> {
  await api.delete(`/projects/${id}`);
}

/**
 * 활성 프로젝트의 .claude 컨텍스트 조회.
 */
export async function fetchContext(projectId: string): Promise<ClaudeContext> {
  const { data } = await api.get<ClaudeContext>("/context", {
    params: { project: projectId },
  });
  return data;
}

/**
 * 서버 파일시스템의 디렉토리 한 단계 조회. 미지정 시 홈.
 */
export async function browseFs(target?: string): Promise<DirListing> {
  const { data } = await api.get<DirListing>("/fs/browse", {
    params: target ? { path: target } : undefined,
  });
  return data;
}

export type EntryKind = "agent" | "skill";

/**
 * 에이전트/스킬 파일 저장 (생성 또는 갱신).
 */
export async function saveEntry(input: {
  projectId: string;
  kind: EntryKind;
  name: string;
  body: string;
}): Promise<void> {
  await api.post("/entries", input);
}

/**
 * 에이전트/스킬 파일 삭제.
 */
export async function deleteEntry(input: {
  projectId: string;
  kind: EntryKind;
  name: string;
}): Promise<void> {
  await api.delete("/entries", { data: input });
}

export type SessionRuntime = {
  pid: number;
  status: string;
  waitingFor?: string;
  version?: string;
  kind?: string;
  startedAt?: number;
  updatedAt?: number;
};

export type SessionInfo = {
  id: string;
  cwd: string;
  encodedDir: string;
  filePath: string;
  modifiedAt: number;
  active: boolean;
  runtime?: SessionRuntime;
};

/**
 * 활성 프로젝트의 Claude Code 세션 목록 조회. ALL이면 전 시스템.
 */
export async function fetchSessions(projectId: string): Promise<SessionInfo[]> {
  const { data } = await api.get<{ sessions: SessionInfo[] }>("/sessions", {
    params: { project: projectId },
  });
  return data.sessions;
}

/**
 * 단일 세션 정보 조회. 페이지 직접 진입 시 사용.
 */
export async function fetchSessionInfo(sessionId: string): Promise<SessionInfo> {
  const { data } = await api.get<SessionInfo>("/sessions/info", {
    params: { sessionId },
  });
  return data;
}

export type SessionFile = {
  /** 절대 경로. */
  path: string;
  /** 파일 전체 크기(bytes). */
  size: number;
  /** 본문이 잘렸는지 여부. 현재 라우트는 항상 false (전체 본문 반환). */
  truncated: boolean;
  /** jsonl 본문 전체. */
  body: string;
};

/**
 * 세션 jsonl 파일의 마지막 N바이트를 가져온다.
 */
export async function fetchSessionFile(
  sessionId: string,
): Promise<SessionFile> {
  const { data } = await api.get<SessionFile>("/sessions/file", {
    params: { sessionId },
  });
  return data;
}

export type SessionEditedFile = {
  path: string;
  count: number;
  firstAt: number;
  lastAt: number;
};

export type SessionUserPrompt = {
  display: string;
  timestamp: number;
};

export type SessionConversationTurn = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  toolCalls?: { name: string; filePath?: string }[];
};

export type SessionExtras = {
  editedFiles: SessionEditedFile[];
  userPrompts: SessionUserPrompt[];
  conversation: SessionConversationTurn[];
};

/**
 * 세션 보조 정보(편집 파일·사용자 프롬프트) 조회.
 */
export async function fetchSessionExtras(
  sessionId: string,
): Promise<SessionExtras> {
  const { data } = await api.get<SessionExtras>("/sessions/extras", {
    params: { sessionId },
  });
  return data;
}

export type SessionTask = {
  /** 태스크 id. 세션 내부에서 1부터 증가. */
  id: string;
  /** 표시되는 짧은 제목(명령형). */
  subject: string;
  /** 무엇을 해야 하는지 상세 설명. */
  description?: string;
  /** in_progress 동안 스피너 옆에 표시되는 진행형 라벨. */
  activeForm?: string;
  /** 진행 상태. `deleted`는 이력 복원 시에만 나타남. */
  status: "pending" | "in_progress" | "completed" | "deleted";
  /** 이 태스크가 끝나야 시작 가능한 태스크 id 들. */
  blocks?: string[];
  /** 이 태스크 시작 전에 끝나야 하는 태스크 id 들. */
  blockedBy?: string[];
  /** 담당 에이전트(있으면). */
  owner?: string;
};

export type SessionTaskEvent = {
  /** jsonl line의 timestamp (epoch ms). 0이면 알 수 없음. */
  ts: number;
  /** 이벤트 종류. */
  kind: "create" | "update";
  /** 영향 받은 태스크 id. */
  taskId: string;
  /** 적용 직후 태스크 스냅샷. */
  snapshot: SessionTask;
};

export type SessionTasksResponse = {
  /** 디스크에 살아있는 라이브 태스크. claude가 진행 중일 때만 존재. */
  live: SessionTask[];
  /** jsonl 재생으로 복원한 *전체* 태스크 (라이브 포함, 완료/삭제 포함). */
  history: SessionTask[];
  /** 리플레이 타임라인. `includeEvents: true`로 요청했을 때만 포함. */
  events?: SessionTaskEvent[];
};

/**
 * 세션이 관리 중인 라이브 태스크 + jsonl 재생으로 복원한 이력을 조회.
 * `includeEvents`가 true면 응답에 events 타임라인이 포함된다(리플레이용).
 */
export async function fetchSessionTasks(
  sessionId: string,
  includeEvents?: boolean,
): Promise<SessionTasksResponse> {
  const params: Record<string, string> = { sessionId };
  if (includeEvents) params.events = "1";
  const { data } = await api.get<SessionTasksResponse>("/sessions/tasks", {
    params,
  });
  return data;
}

/**
 * 세션 jsonl 파일을 삭제한다.
 */
export async function deleteSessionFile(sessionId: string): Promise<void> {
  await api.delete("/sessions/file", { params: { sessionId } });
}

/**
 * 프로젝트의 workDir에서 새 Claude Code 세션을 띄운다.
 * 서버는 macOS Terminal/iTerm/Ghostty를 띄워 `claude`(+ optional prompt)를 실행한다.
 * 반환 객체의 cwd는 실제 사용된 작업 디렉토리.
 *
 * initialPrompt가 있으면 설정의 기본 프롬프트와 줄바꿈으로 합쳐 전달된다.
 */
export async function launchSession(
  projectId: string,
  options?: { initialPrompt?: string; ignoreDefaultPrompt?: boolean },
): Promise<{ cwd: string }> {
  const { data } = await api.post<{ cwd: string }>("/sessions/launch", {
    projectId,
    initialPrompt: options?.initialPrompt,
    ignoreDefaultPrompt: options?.ignoreDefaultPrompt,
  });
  return data;
}

/**
 * 기존 세션을 `claude --resume <id>`로 이어간다. 서버는 세션 cwd를 jsonl에서 읽어
 * 그 디렉토리에서 새 터미널 창을 띄운다.
 */
export async function resumeSession(
  sessionId: string,
): Promise<{ cwd: string; sessionId: string }> {
  const { data } = await api.post<{ cwd: string; sessionId: string }>(
    "/sessions/resume",
    { sessionId },
  );
  return data;
}

export type FileHit = {
  /** 검색 기준 디렉토리 기준 상대 경로. */
  relative: string;
  /** 절대 경로. */
  absolute: string;
};

/**
 * 활성 프로젝트의 디렉토리 트리에서 파일명을 검색한다. @-자동완성에 사용.
 */
export async function searchFiles(
  projectId: string,
  query: string,
): Promise<FileHit[]> {
  const { data } = await api.get<{ baseDir: string; hits: FileHit[] }>(
    "/fs/search",
    { params: { project: projectId, q: query } },
  );
  return data.hits;
}
