"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  Plus,
  Send,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/app/components/ui/cn";
import { Button, ConfirmDialog } from "@/app/components/ui";
import { useProjects } from "@/app/components/use-projects";
import { useChatbot, type ChatSessionMeta } from "./use-chatbot";
import { ChatMessageList } from "./ChatMessageList";

/**
 * 우측 하단 floating 챗봇.
 * - 닫힘: 봇 아이콘 버튼만.
 * - 열림: 리스트 뷰(세션 목록) ↔ 채팅 뷰. 뒤로가기로 리스트 복귀.
 * - 닫기는 패널만 닫고 세션 리스트는 localStorage에 보존.
 */
export function ChatBotWidget() {
  const [open, setOpen] = useState(false);
  const {
    view,
    sessions,
    messages,
    isStreaming,
    streamingSessionIds,
    isHistoryLoading,
    defaultProjectId,
    setDefaultProjectId,
    openSession,
    startNew,
    goBack,
    send,
    abort,
    deleteSession,
  } = useChatbot();
  const { projects } = useProjects();
  const [confirmDelete, setConfirmDelete] = useState<ChatSessionMeta | null>(
    null,
  );

  const selectableProjects = projects.filter((p) => p.id !== "ALL");
  const projectName = (id: string) =>
    selectableProjects.find((p) => p.id === id)?.name ?? id;

  useEffect(() => {
    if (!defaultProjectId && selectableProjects.length > 0) {
      setDefaultProjectId(selectableProjects[0].id);
    }
  }, [defaultProjectId, selectableProjects, setDefaultProjectId]);

  if (!open) {
    return (
      <button
        type="button"
        aria-label="챗봇 열기"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 inline-flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Bot className="h-6 w-6" aria-hidden />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[min(820px,calc(100vh-3rem))] w-[min(560px,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
      {view.kind === "list" ? (
        <ListView
          sessions={sessions}
          projects={selectableProjects}
          defaultProjectId={defaultProjectId}
          streamingSessionIds={streamingSessionIds}
          onChangeDefaultProject={setDefaultProjectId}
          onOpen={openSession}
          onStartNew={startNew}
          onRequestDelete={(s) => setConfirmDelete(s)}
          onClose={() => setOpen(false)}
          projectName={projectName}
        />
      ) : (
        <ChatView
          sessionId={view.sessionId}
          projectId={view.projectId}
          projectName={projectName(view.projectId)}
          messages={messages}
          isStreaming={isStreaming}
          isHistoryLoading={isHistoryLoading}
          onBack={goBack}
          onClose={() => {
            // 패널을 닫을 때 view를 list로 되돌려 EventSource 구독을 함께 해제한다
            // (브라우저 6 connection 제한을 잠식하지 않게).
            goBack();
            setOpen(false);
          }}
          onSend={send}
          onAbort={abort}
        />
      )}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="대화 삭제"
        message={
          <>
            <span className="font-medium">
              {confirmDelete?.title ?? ""}
            </span>{" "}
            대화를 목록에서 삭제할까요?
            <br />
            <span className="text-xs text-zinc-500">
              세션 jsonl 파일 자체는 보존됩니다.
            </span>
          </>
        }
        confirmLabel="삭제"
        variant="danger"
        onConfirm={() => {
          if (confirmDelete) deleteSession(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ListView({
  sessions,
  projects,
  defaultProjectId,
  streamingSessionIds,
  onChangeDefaultProject,
  onOpen,
  onStartNew,
  onRequestDelete,
  onClose,
  projectName,
}: {
  /** 보관된 채팅 세션 메타들. 최근 활동 순으로 표시한다. */
  sessions: ChatSessionMeta[];
  /** 새 대화에 사용할 프로젝트 후보 (ALL 제외). */
  projects: Array<{ id: string; name: string }>;
  /** 기본 프로젝트 id (마지막 사용). 새 대화에서 사용. */
  defaultProjectId: string | null;
  /** 현재 응답을 스트리밍 중인 세션 id 집합 (다른 탭 포함). 항목 점멸 인디케이터에 사용. */
  streamingSessionIds: Set<string>;
  /** 기본 프로젝트 변경. */
  onChangeDefaultProject: (id: string) => void;
  /** 세션 진입. */
  onOpen: (sessionId: string, projectId: string) => void;
  /** 새 대화 시작. */
  onStartNew: (projectId: string) => void;
  /** 삭제 확인 요청 (실제 삭제는 부모의 ConfirmDialog 이후). */
  onRequestDelete: (session: ChatSessionMeta) => void;
  /** 패널 닫기. */
  onClose: () => void;
  /** id → 이름 lookup. */
  projectName: (id: string) => string;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <Bot className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">채팅</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <select
          value={defaultProjectId ?? ""}
          onChange={(e) => onChangeDefaultProject(e.target.value)}
          className="min-w-0 flex-1 truncate rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
        >
          {projects.length === 0 ? (
            <option value="">프로젝트를 등록하세요</option>
          ) : (
            projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          )}
        </select>
        <Button
          size="sm"
          onClick={() => defaultProjectId && onStartNew(defaultProjectId)}
          disabled={!defaultProjectId}
          aria-label="새 대화"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          <span>새 대화</span>
        </Button>
      </div>
      <ul className="scroll-thin flex-1 divide-y divide-zinc-200 overflow-y-auto overscroll-contain dark:divide-zinc-800">
        {sorted.length === 0 ? (
          <li className="grid h-full place-items-center text-center text-xs text-zinc-500">
            대화가 없습니다.
            <br />위에서 새 대화를 시작해보세요.
          </li>
        ) : (
          sorted.map((s) => {
            const streaming = streamingSessionIds.has(s.id);
            return (
              <li
                key={s.id}
                className="flex items-center gap-2 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <button
                  type="button"
                  onClick={() => onOpen(s.id, s.projectId)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {s.lastMessage ?? s.title}
                    </span>
                    {streaming && (
                      <span
                        className="inline-flex h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
                        aria-label="응답 중"
                        title="응답 중"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="truncate">{projectName(s.projectId)}</span>
                    <span>·</span>
                    <span>
                      {streaming ? "응답 중…" : formatRelative(s.updatedAt)}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => onRequestDelete(s)}
                  aria-label="삭제"
                  title="목록에서 제거"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:text-zinc-400 dark:hover:bg-red-950 dark:hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}

function ChatView({
  sessionId,
  projectId,
  projectName,
  messages,
  isStreaming,
  isHistoryLoading,
  onBack,
  onClose,
  onSend,
  onAbort,
}: {
  /** 현재 이어가는 세션 id. 첫 응답 전까진 null. */
  sessionId: string | null;
  /** cwd로 사용할 프로젝트 id. */
  projectId: string;
  /** 헤더에 표시할 프로젝트 이름. */
  projectName: string;
  /** 표시할 메시지. */
  messages: ReturnType<typeof useChatbot>["messages"];
  /** 응답 스트리밍 중. */
  isStreaming: boolean;
  /** jsonl history fetch 중. */
  isHistoryLoading: boolean;
  /** 리스트로 복귀. */
  onBack: () => void;
  /** 패널 닫기. */
  onClose: () => void;
  /** 메시지 전송. */
  onSend: (msg: string) => void;
  /** 진행 중 응답 중단. */
  onAbort: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          aria-label="뒤로"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{projectName}</div>
          {sessionId && (
            <div className="truncate font-mono text-[10px] text-zinc-500">
              {sessionId.slice(0, 8)}
            </div>
          )}
        </div>
        {sessionId && (
          <Link
            href={`/sessions/${sessionId}`}
            title="세션 상세 페이지로 이동"
            aria-label="세션 상세로 이동"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {isHistoryLoading ? (
        <div className="grid flex-1 place-items-center text-xs text-zinc-500">
          이전 대화 불러오는 중…
        </div>
      ) : (
        <ChatMessageList messages={messages} isStreaming={isStreaming} />
      )}
      <ChatInput
        disabled={!projectId || projectId === "ALL"}
        isStreaming={isStreaming}
        onSend={onSend}
        onAbort={onAbort}
      />
    </>
  );
}

function ChatInput({
  disabled,
  isStreaming,
  onSend,
  onAbort,
}: {
  /** 프로젝트 미선택 등으로 입력 자체가 막혀 있는지. */
  disabled: boolean;
  /** 어시스턴트 응답 스트리밍 중인지. true면 전송 대신 중단 버튼. */
  isStreaming: boolean;
  /** 메시지 전송 핸들러. */
  onSend: (msg: string) => void;
  /** 진행 중 응답 중단. */
  onAbort: () => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim() || isStreaming) return;
    onSend(value);
    setValue("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex items-end gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800"
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        placeholder={
          disabled ? "프로젝트를 선택하세요" : "메시지 (Enter 전송, Shift+Enter 줄바꿈)"
        }
        rows={4}
        className={cn(
          "scroll-thin min-h-[88px] min-w-0 flex-1 resize-none rounded-md border border-zinc-200 bg-white px-2 py-2 text-sm leading-6 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950",
        )}
      />
      {isStreaming ? (
        <Button type="button" variant="ghost" onClick={onAbort} aria-label="중단">
          <Square className="h-4 w-4" aria-hidden />
          <span>중단</span>
        </Button>
      ) : (
        <Button type="submit" disabled={disabled || !value.trim()} aria-label="전송">
          <Send className="h-4 w-4" aria-hidden />
          <span>전송</span>
        </Button>
      )}
    </form>
  );
}

/** 절대 시각을 "방금/N분 전/N시간 전/MM-DD" 등으로 표현. */
function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
