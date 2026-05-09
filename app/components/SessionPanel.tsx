"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Info,
  ListChecks,
  MessageSquarePlus,
  Play,
  PlayCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SessionMarkdown } from "./SessionMarkdown";
import { SidechainBadge } from "./SidechainBadge";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  RefreshControl,
  SortToggle,
  type SortOrder,
  Tooltip,
  cn,
  inputBaseClass,
} from "./ui";
import {
  useDeleteSessions,
  useLaunchSession,
  useResumeSession,
  useSessions,
} from "./use-sessions";
import {
  fetchSessionExtras,
  fetchSessionFile,
  fetchSessionTasks,
  type SessionInfo,
  type SessionTask,
} from "./project-client";
import {
  SessionTasksReplayControls,
  useReplayAutoplay,
  useReplayTasks,
} from "./SessionTasksReplay";
import {
  SessionLogView,
  SessionStatsRow,
  computeSessionStats,
  parseSessionLog,
} from "./SessionLogView";

/** 태스크 그래프 뷰는 무겁고 별도 페치를 가지므로 동적 import 한다. */
const SessionTaskGraphView = lazy(() => import("./SessionTaskGraphView"));

type SessionPanelProps = {
  /** 활성 프로젝트 id. ALL이면 전체 시스템 세션. */
  projectId: string;
};

/**
 * Claude Code 세션 목록. ~/.claude/projects/* 의 jsonl 파일을 mtime 기준으로 표시.
 */
export function SessionPanel({ projectId }: SessionPanelProps) {
  const { sessions, isLoading, isFetching, refetch, dataUpdatedAt } =
    useSessions(projectId);
  const { remove, isPending: isDeleting } = useDeleteSessions();
  const { launch, isPending: isLaunching } = useLaunchSession();
  const { resume, isPending: isResuming } = useResumeSession();
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activityHelpOpen, setActivityHelpOpen] = useState(false);
  const activeCount = sessions.filter((s) => s.active).length;
  const selectedSessions = sessions.filter((s) => selected.has(s.filePath));

  useEffect(() => {
    // 프로젝트 전환 시 선택/편집 상태를 초기화 — 이전 프로젝트의 세션 선택이 새 목록에 잘못 반영되는 것을 방지.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditMode(false);
     
    setSelected(new Set());
  }, [projectId]);

  function toggleEditMode() {
    setEditMode((prev) => {
      if (prev) setSelected(new Set());
      return !prev;
    });
  }

  function toggleSelected(session: SessionInfo) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(session.filePath)) next.delete(session.filePath);
      else next.add(session.filePath);
      return next;
    });
  }

  function confirmBulkDelete() {
    if (selectedSessions.length === 0) {
      setConfirmOpen(false);
      return;
    }
    remove(selectedSessions, {
      onSettled: () => {
        setSelected(new Set());
        setEditMode(false);
        setConfirmOpen(false);
      },
    });
  }

  return (
    <Card>
      <CardHeader className="items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <CardTitle>세션</CardTitle>
            <button
              type="button"
              onClick={() => setActivityHelpOpen(true)}
              aria-label="세션이란?"
              title="세션이란?"
              className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            활성 {activeCount} / 전체 {sessions.length}
          </div>
        </div>
        <RefreshControl
          onClick={refetch}
          isFetching={isFetching}
          timestamp={dataUpdatedAt}
        />
      </CardHeader>
      {!editMode && (sessions.length > 0 || projectId !== "ALL") && (
        <div className="flex items-center justify-end gap-1 border-b border-zinc-100 px-4 py-1.5 dark:border-zinc-900">
          {projectId !== "ALL" && (
            <LaunchSplitButton
              projectId={projectId}
              isLaunching={isLaunching}
              onLaunchImmediate={() => launch(projectId)}
              onLaunchIgnoringDefault={() =>
                launch(projectId, { ignoreDefaultPrompt: true })
              }
              onLaunchWithPrompt={(prompt) =>
                launch(projectId, { initialPrompt: prompt })
              }
            />
          )}
          {sessions.length > 0 && (
            <button
              type="button"
              onClick={toggleEditMode}
              aria-label="선택 모드"
              title="여러 세션 선택"
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
              <span>선택</span>
            </button>
          )}
        </div>
      )}
      {sessions.length > 0 && editMode && (
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <button
              type="button"
              onClick={() => {
                const selectable = sessions;
                if (selected.size === selectable.length) setSelected(new Set());
                else setSelected(new Set(selectable.map((s) => s.filePath)));
              }}
              className="rounded border border-zinc-200 px-2 py-1 hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-950"
            >
              {selected.size === sessions.length
                ? "전체 해제"
                : "전체 선택"}
            </button>
            <span>
              선택{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {selected.size}
              </span>
              {" / "}
              {sessions.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={selected.size === 0}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1 transition-colors",
                selected.size === 0
                  ? "cursor-not-allowed border-zinc-200 text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
                  : "border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              <span>{selected.size}개 삭제</span>
            </button>
            <button
              type="button"
              onClick={toggleEditMode}
              className="rounded border border-zinc-200 px-2 py-1 text-zinc-600 hover:bg-white dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-950"
            >
              취소
            </button>
          </div>
        </div>
      )}
      <CardBody className="p-0">
        {isLoading ? (
          <div className="px-4 py-4">
            <EmptyState>로딩 중…</EmptyState>
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-4">
            <EmptyState>세션 없음</EmptyState>
          </div>
        ) : (
          <ul className="scroll-thin max-h-[60vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
            {sessions.map((s) => (
              <SessionRow
                key={s.filePath}
                session={s}
                showCwd={projectId === "ALL"}
                editMode={editMode}
                selected={selected.has(s.filePath)}
                onToggleSelect={() => toggleSelected(s)}
                onResume={() => resume(s.id)}
                isResuming={isResuming}
              />
            ))}
          </ul>
        )}
      </CardBody>
      <Modal
        open={activityHelpOpen}
        onClose={() => setActivityHelpOpen(false)}
        title="세션이란?"
        size="md"
      >
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              개요
            </h3>
            <p>
              Claude Code가 한 번의 대화 단위로 남기는 기록입니다.
              <br />
              메시지·툴 호출·결과가 jsonl 파일에 한 줄씩 누적되며,
              <br />
              한 jsonl 파일이 곧 하나의 세션입니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              저장 위치
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-900">
                  ~/.claude/projects/&lt;인코딩된 cwd&gt;/&lt;sessionId&gt;.jsonl
                </code>
              </li>
              <li>
                인코딩 규칙: 절대 경로의{" "}
                <code className="rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-900">
                  /
                </code>{" "}
                를{" "}
                <code className="rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-900">
                  -
                </code>{" "}
                로 치환
              </li>
              <li>프로젝트 매칭은 prefix로 — 하위 디렉토리에서 시작한 세션도 포함</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              활성 / 유휴
            </h3>
            <p>jsonl 파일의 마지막 수정 시각(mtime)을 기준으로 분류합니다.</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                최근{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  5분 이내
                </span>{" "}
                갱신 → <Badge variant="success">활성</Badge>
              </li>
              <li>
                그 외 → <Badge variant="default">유휴</Badge>
              </li>
            </ul>
            <p className="text-xs text-zinc-500">
              프로세스 PID 검사가 아니므로 종료 직후 5분간은 활성으로 표시될
              수 있고,
              <br />
              긴 응답을 기다리는 세션은 출력 직전까지 유휴로 보일 수 있습니다.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              이 화면에서 할 수 있는 일
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <Info className="mb-0.5 inline h-3.5 w-3.5" aria-hidden /> 버튼 →
                세션 ID·cwd·파일 경로·로그 확인
              </li>
              <li>편집 모드(연필) → 여러 세션을 골라 휴지통으로 일괄 삭제</li>
              <li>삭제는 jsonl 파일을 영구히 제거하므로 복구 불가</li>
            </ul>
          </section>

          <section className="flex flex-col gap-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
            <div className="text-zinc-500">
              관련 코드:{" "}
              <code className="rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-900">
                lib/sessions.ts
              </code>
              ,{" "}
              <code className="rounded bg-zinc-100 px-1 font-mono text-[11px] dark:bg-zinc-900">
                ACTIVE_WINDOW_MS
              </code>
            </div>
          </section>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title="세션 삭제"
        size="lg"
        message={
          <div className="flex flex-col gap-3">
            <div>
              선택한{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {selectedSessions.length}
              </span>
              개의 세션을 삭제합니다.
            </div>
            {selectedSessions.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <ul className="scroll-thin max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
                  {selectedSessions.map((s) => (
                    <li
                      key={s.filePath}
                      className="flex items-center gap-3 px-4 py-3 text-xs"
                    >
                      {isAlive(s) ? (
                        <Badge variant="warning">실행중 pid {s.runtime!.pid}</Badge>
                      ) : (
                        <Badge variant={s.active ? "success" : "default"}>
                          {s.active ? "활성" : "유휴"}
                        </Badge>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="break-all font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                          {s.id}
                        </div>
                        <div className="truncate font-mono text-[10px] text-zinc-500">
                          {s.cwd}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {formatRelative(s.modifiedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(() => {
              const aliveCount = selectedSessions.filter(isAlive).length;
              return (
                <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                  <li>해당 세션의 jsonl 파일이 영구 삭제됩니다.</li>
                  <li>대화/도구 사용 기록을 더 이상 복구할 수 없습니다.</li>
                  {aliveCount > 0 && (
                    <li className="text-red-600 dark:text-red-400">
                      ⚠️ 살아있는 프로세스 {aliveCount}개도 SIGTERM(필요 시 SIGKILL)으로 종료됩니다 — 해당 터미널의 작업 컨텍스트가 사라집니다.
                    </li>
                  )}
                </ul>
              );
            })()}
            <div className="text-zinc-500">계속하시겠습니까?</div>
          </div>
        }
        confirmLabel={isDeleting ? "삭제 중…" : "삭제"}
        variant="danger"
        onConfirm={confirmBulkDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  );
}

/**
 * 세션이 "실행 중"인지 (= 매핑된 Claude Code 프로세스가 살아있는지) 판단.
 * 서버가 readAllRuntimeStatuses에서 이미 stale pid를 걸러내므로 runtime 존재만으로 판정 가능.
 */
function isAlive(session: SessionInfo): boolean {
  return Boolean(session.runtime);
}

/** 런타임이 살아 있으면 그 상태를, 아니면 mtime 기반 활성/유휴를 표시. */
function SessionStatusBadge({ session }: { session: SessionInfo }) {
  if (session.runtime) {
    const { label, variant } = describeRuntime(session.runtime.status);
    return (
      <Tooltip
        content={runtimeTooltip(session.runtime)}
        className="w-16 shrink-0 justify-center"
      >
        <Badge variant={variant}>
          <span className="inline-block w-12 text-center">{label}</span>
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      content={mtimeTooltip(session)}
      className="w-16 shrink-0 justify-center"
    >
      <Badge variant={session.active ? "success" : "default"}>
        <span className="inline-block w-12 text-center">
          {session.active ? "활성" : "유휴"}
        </span>
      </Badge>
    </Tooltip>
  );
}

/**
 * 런타임 상태 hover 안내. 같은 라벨이라도 의미가 다를 수 있어 한 문장으로 풀어준다.
 * pid·버전·시작 시각 같은 메타는 행 본문에 이미 노출되므로 여기선 *상태의 뜻*만 다룬다.
 */
function runtimeTooltip(rt: NonNullable<SessionInfo["runtime"]>): string {
  const s = rt.status.toLowerCase();
  if (s.includes("running") || s.includes("busy")) {
    return "어시스턴트가 응답을 만들고 있습니다";
  }
  if (s.includes("dialog")) {
    return "대화상자가 열려 사용자의 선택을 기다립니다";
  }
  if (s.includes("wait")) {
    return rt.waitingFor
      ? `사용자 입력 대기 중 (${rt.waitingFor})`
      : "사용자 입력을 기다리는 중입니다";
  }
  if (s.includes("idle")) {
    return "유휴 상태이나 프로세스는 살아있습니다";
  }
  return "프로세스가 살아있습니다";
}

/** 런타임이 없는 세션의 hover 안내 — *왜* 이렇게 분류됐는지 한 문장으로. */
function mtimeTooltip(session: SessionInfo): string {
  return session.active
    ? "최근 5분 이내 활동이 있었지만 실행 중인 프로세스는 없습니다"
    : "종료된 세션 — 5분 이상 변경이 없습니다";
}

/** Claude Code의 runtime.status 문자열을 한국어 라벨 + Badge variant로 변환. */
function describeRuntime(status: string): {
  label: string;
  variant: "success" | "info" | "warning" | "default";
} {
  const s = status.toLowerCase();
  if (s.includes("running") || s.includes("busy")) {
    return { label: "응답 중", variant: "warning" };
  }
  if (s.includes("dialog")) {
    return { label: "대화상자", variant: "info" };
  }
  if (s.includes("wait")) {
    return { label: "입력 대기", variant: "info" };
  }
  if (s.includes("idle")) {
    return { label: "유휴", variant: "success" };
  }
  return { label: "활성", variant: "success" };
}

function SessionRow({
  session,
  showCwd,
  editMode,
  selected,
  onToggleSelect,
  onResume,
  isResuming,
}: {
  /** 표시할 세션. */
  session: SessionInfo;
  /** 전체 모드일 때는 cwd를 표시한다. */
  showCwd: boolean;
  /** 편집 모드면 좌측에 체크박스가 보인다. */
  editMode: boolean;
  /** 체크박스 선택 상태. */
  selected: boolean;
  /** 체크박스 토글. */
  onToggleSelect: () => void;
  /** `claude --resume <id>`로 이 세션을 새 터미널에서 이어간다. */
  onResume: () => void;
  /** 다른 세션 resume 진행 중 여부. UI 잠금용. */
  isResuming: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 px-4 py-3 text-xs transition-colors",
        editMode && selected
          ? "bg-zinc-100 dark:bg-zinc-900"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
      )}
    >
      {editMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label="세션 선택"
          title={
            isAlive(session)
              ? "선택 시 삭제하면 살아있는 프로세스도 함께 종료됩니다"
              : undefined
          }
          className="h-4 w-4 shrink-0 cursor-pointer accent-zinc-900 dark:accent-zinc-100"
        />
      )}
      <Link
        href={`/sessions/${session.id}`}
        aria-label="세션 정보"
        title="세션 정보"
        className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </Link>
      <SessionStatusBadge session={session} />
      <div className="min-w-0 flex-1">
        <div className="break-all font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
          {session.id}
        </div>
        {showCwd && (
          <div className="truncate font-mono text-[10px] text-zinc-500">
            {session.cwd}
          </div>
        )}
        {session.runtime && (
          <div className="truncate font-mono text-[10px] text-zinc-500">
            pid {session.runtime.pid}
            {session.runtime.version ? ` · v${session.runtime.version}` : ""}
            {session.runtime.kind ? ` · ${session.runtime.kind}` : ""}
            {session.runtime.startedAt
              ? ` · 프로세스 시작 ${formatRelative(session.runtime.startedAt)}`
              : ""}
          </div>
        )}
      </div>
      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
        {formatRelative(session.modifiedAt)}
      </span>
      {!editMode && (
        <button
          type="button"
          onClick={onResume}
          disabled={isResuming || Boolean(session.runtime)}
          aria-label="세션 이어가기"
          title={
            session.runtime
              ? "프로세스가 살아있어 새로 띄울 수 없습니다 — 기존 터미널에서 계속하거나 종료 후 시도하세요"
              : "claude --resume 으로 이 세션을 새 터미널에서 이어갑니다"
          }
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <PlayCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}

type SessionTab =
  | "files"
  | "conversation"
  | "tasks"
  | "timeline"
  | "trace"
  | "trace_v2"
  | "swim"
  | "charts"
  | "raw";

/**
 * 각 탭이 어떤 데이터/뷰를 제공하는지 설명한다.
 * 다이얼로그에서 한 줄 도입(intro) + bullet 리스트(points)로 분리 렌더되어
 * 한 문단보다 시인성이 좋다.
 */
const SESSION_TABS: {
  id: SessionTab;
  label: string;
  intro: string;
  points: string[];
}[] = [
  {
    id: "tasks",
    label: "태스크",
    intro: "이 세션이 진행 중인 내부 TaskList/Todo 목록.",
    points: [
      "claude 본체가 ~/.claude/tasks/<sessionId>/ 또는 ~/.claude/todos/ 에 저장한 파일을 읽어 표시",
      "상태(pending · in_progress · completed)별로 묶어 한눈에 진행도 파악",
      "5초마다 폴링해 실시간에 가까운 갱신 (사용자 액션 발생 시점 한정)",
    ],
  },
  {
    id: "conversation",
    label: "대화",
    intro: "사용자 ↔ 어시스턴트 대화 흐름만 추려 보여주는 뷰.",
    points: [
      "사용자 프롬프트 + 어시스턴트 응답 텍스트만 발췌",
      "도구 호출/결과 같은 노이즈는 제외",
      "긴 대화에서 무엇을 주고받았는지 빠르게 훑기 좋음",
    ],
  },
  {
    id: "files",
    label: "편집 파일",
    intro: "이 세션에서 편집된 파일 목록.",
    points: [
      "Edit · MultiEdit · Write · NotebookEdit 도구로 변경된 파일만 집계",
      "파일별 변경 횟수, 첫 변경·마지막 변경 시각 표시",
      "어떤 파일을 가장 많이 손댔는지 한눈에 파악",
    ],
  },
  {
    id: "timeline",
    label: "타임라인",
    intro: "jsonl 모든 이벤트의 시간순 단일 리스트.",
    points: [
      "사용자 · 어시스턴트 · 도구 호출 · 도구 결과 · 시스템 · 요약 전부 포함",
      "Edit/MultiEdit/Write 호출은 펼쳐서 diff까지 확인 가능",
      "양이 많아도 가상화로 보이는 행만 렌더",
    ],
  },
  {
    id: "trace",
    label: "트레이스",
    intro: "사용자 입력 1회 = 1턴 단위로 묶은 트리 뷰.",
    points: [
      "각 턴 안에 어시스턴트 텍스트 + 도구 호출(↔ 결과 매칭) 들여쓰기",
      "서브에이전트 호출은 별도 색상으로 시각 분리",
      "도구 호출이 많은 턴은 처음 몇 개만 보여주고 \"펼치기\" 제공",
    ],
  },
  {
    id: "trace_v2",
    label: "트레이스 V2",
    intro: "Datadog 스타일 trace/span waterfall (실험).",
    points: [
      "세션 전체 = 1 trace, 사용자 턴 = root span, 도구 호출 = child span",
      "시간축에 막대로 위치·기간을 시각화 — 어느 도구가 오래 걸렸는지 한눈에",
      "서브에이전트 도구는 한 단계 더 들여쓴 자식 span으로 구분",
      "행 클릭 시 하단에 입력/결과/diff 상세 패널",
    ],
  },
  {
    id: "swim",
    label: "스윔레인",
    intro: "종류별 행 × 시간 축의 이벤트 분포 차트.",
    points: [
      "행: 사용자 · 어시스턴트 · 도구 · 결과 (서브에이전트 있으면 추가)",
      "각 점은 한 이벤트 — 마우스를 올리면 미리보기가 뜸",
      "어느 시간대에 어떤 활동이 몰렸는지 시각적으로 파악",
    ],
  },
  {
    id: "charts",
    label: "통계",
    intro: "세 가지 막대 차트로 보는 세션 요약.",
    points: [
      "시간대별 활동량 (30개 구간으로 분할)",
      "이벤트 타입 분포 (사용자/어시스턴트/도구/결과 등)",
      "도구 사용 빈도 상위 8개",
    ],
  },
  {
    id: "raw",
    label: "원본",
    intro: "jsonl 파일 본문을 가공 없이 그대로 표시.",
    points: [
      "마지막 256KB만 로드 (큰 세션 보호)",
      "디버깅 · 복사 · 외부 도구 분석용",
    ],
  },
];

const LOG_TABS = new Set<SessionTab>([
  "timeline",
  "trace",
  "trace_v2",
  "swim",
  "charts",
  "raw",
]);

/**
 * 세션 상세 본문. 페이지 라우트(/sessions/[id])에서 호스팅된다.
 *
 * 상단: 통계 요약 (이벤트·사용자/어시스턴트·도구 호출·기간·모델)
 * 그 아래: 단일 탭 바. 정보·편집 파일·대화 + 세션 로그의 세부 뷰들이
 * 모두 동일한 레벨에 평탄하게 노출된다.
 */
export function SessionDetailView({
  session,
  highlightTaskId,
}: {
  session: SessionInfo;
  /** 진입 직후 잠깐 강조할 태스크 id. 알림 클릭 동선에서 전달. */
  highlightTaskId?: string;
}) {
  // 탭은 URL ?tab=...에서 파생. 단일 진실 원천이라 알림 재진입과 수동 클릭이 충돌하지 않는다.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: SessionTab =
    SESSION_TABS.find((t) => t.id === rawTab)?.id ?? "tasks";
  const setTab = useCallback(
    (next: SessionTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      // taskId는 tasks 탭에서만 의미가 있으므로 다른 탭으로 이동하면 정리.
      if (next !== "tasks") params.delete("taskId");
      // history entry를 만들지 않아 뒤로가기로 탭 토글 히스토리에 갇히지 않게 한다.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const [infoTab, setInfoTab] = useState<SessionTab | null>(null);
  /**
   * 본문 마운트는 탭 클릭 페인트 이후 한 프레임 미룬다.
   * 같은 commit에서 무거운 본문(타임라인/스윔/통계)을 mount/unmount하면 클릭 → 활성 표시까지 막혀
   * 멈춘 듯 보이므로, 버튼이 먼저 페인트되고 다음 프레임에 본문이 마운트되도록 분리.
   */
  const [bodyTab, setBodyTab] = useState<SessionTab>(tab);
  useEffect(() => {
    if (bodyTab === tab) return;
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setBodyTab(tab));
    });
    return () => {
      cancelAnimationFrame(id1);
      if (id2) cancelAnimationFrame(id2);
    };
  }, [tab, bodyTab]);
  const isTabSwitching = bodyTab !== tab;
  const {
    data: file,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ["session-file", session.id],
    queryFn: () => fetchSessionFile(session.id),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const body = file?.body;
  const events = useMemo(
    () => (body ? parseSessionLog(body) : []),
    [body],
  );
  const stats = useMemo(() => computeSessionStats(events), [events]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <SessionInfoPanel session={session} startedAt={stats.firstTs} />
        </div>
        <RefreshControl
          onClick={() => void refetch()}
          isFetching={isFetching}
          timestamp={dataUpdatedAt}
        />
      </div>
      {events.length > 0 && (
        <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <SessionStatsRow stats={stats} />
        </div>
      )}
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {SESSION_TABS.map((t) => (
          <div
            key={t.id}
            className={cn(
              "-mb-px flex items-center border-b-2 transition-colors",
              tab === t.id
                ? "border-zinc-900 dark:border-zinc-100"
                : "border-transparent",
            )}
          >
            <button
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "py-2 pl-3 pr-1 text-sm transition-colors",
                tab === t.id
                  ? "font-medium text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100",
              )}
            >
              {t.label}
            </button>
            <button
              type="button"
              onClick={() => setInfoTab(t.id)}
              aria-label={`${t.label} 탭 설명`}
              title={`${t.label} 탭 설명`}
              className="py-2 pl-1 pr-3 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
      {infoTab !== null && (() => {
        const info = SESSION_TABS.find((t) => t.id === infoTab);
        if (!info) return null;
        return (
          <Modal
            open
            onClose={() => setInfoTab(null)}
            title={info.label}
            size="md"
          >
            <div className="flex flex-col gap-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
              <p>{info.intro}</p>
              <ul className="flex flex-col gap-1.5 pl-4 text-[13px] text-zinc-600 dark:text-zinc-400">
                {info.points.map((p, i) => (
                  <li key={i} className="list-disc marker:text-zinc-400">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </Modal>
        );
      })()}
      {isTabSwitching ? (
        <SessionTabSkeleton />
      ) : (
        <>
          {bodyTab === "files" && (
            <SessionEditedFilesPanel sessionId={session.id} />
          )}
          {bodyTab === "conversation" && (
            <SessionConversationPanel sessionId={session.id} />
          )}
          {bodyTab === "tasks" && (
            <SessionTasksPanel
              sessionId={session.id}
              focusTaskId={highlightTaskId}
            />
          )}
          {LOG_TABS.has(bodyTab) &&
            (file ? (
              <SessionLogView
                body={file.body}
                view={
                  bodyTab as
                    | "timeline"
                    | "trace"
                    | "trace_v2"
                    | "swim"
                    | "charts"
                    | "raw"
                }
                sessionId={session.id}
                subagentParents={file.subagentParents}
                hideChrome
              />
            ) : (
              <SessionTabSkeleton />
            ))}
        </>
      )}
    </div>
  );
}

/**
 * 탭 전환 직후 보여줄 자리표시자. 본문 렌더가 deferred로 한 프레임 뒤에 도착해도
 * 탭 클릭이 먼저 시각적으로 반영되도록 하는 brief한 placeholder.
 * 탭 종류에 따라 비슷한 골격을 그려 레이아웃 점프를 줄인다.
 */
function SessionTabSkeleton() {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      데이터 로딩 중…
    </div>
  );
}

function SessionInfoPanel({
  session,
  startedAt,
}: {
  session: SessionInfo;
  /** jsonl 첫 이벤트 timestamp (epoch ms). 없으면 행 자체를 숨긴다. */
  startedAt?: number;
}) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] items-center gap-x-3 gap-y-2 text-xs [&>dd]:min-h-6 [&>dd]:flex [&>dd]:flex-wrap [&>dd]:items-center [&>dt]:min-h-6 [&>dt]:flex [&>dt]:items-center">
      <dt className="text-zinc-500">상태</dt>
      <dd>
        <Badge variant={session.active ? "success" : "default"}>
          {session.active ? "활성" : "유휴"}
        </Badge>
      </dd>
      <dt className="text-zinc-500">세션 ID</dt>
      <dd className="break-all font-mono">{session.id}</dd>
      <dt className="text-zinc-500">작업 디렉토리</dt>
      <dd className="break-all font-mono">{session.cwd}</dd>
      <dt className="text-zinc-500">파일 경로</dt>
      <dd className="break-all font-mono text-zinc-600 dark:text-zinc-400">
        {session.filePath}
      </dd>
      {startedAt !== undefined && (
        <>
          <dt className="text-zinc-500">세션 시작</dt>
          <dd>
            <span>{new Date(startedAt).toLocaleString()}</span>
            <span className="ml-2 text-zinc-500">
              ({formatRelative(startedAt)})
            </span>
          </dd>
        </>
      )}
      <dt className="text-zinc-500">마지막 수정</dt>
      <dd>
        <span>{new Date(session.modifiedAt).toLocaleString()}</span>
        <span className="ml-2 text-zinc-500">
          ({formatRelative(session.modifiedAt)})
        </span>
      </dd>
      {session.runtime && (
        <>
          <dt className="text-zinc-500">런타임 상태</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <SessionStatusBadge session={session} />
            <span className="font-mono text-[11px] text-zinc-500">
              pid {session.runtime.pid}
              {session.runtime.version ? ` · v${session.runtime.version}` : ""}
              {session.runtime.kind ? ` · ${session.runtime.kind}` : ""}
            </span>
          </dd>
          {session.runtime.waitingFor && (
            <>
              <dt className="text-zinc-500">대기 사유</dt>
              <dd className="font-mono text-[11px]">{session.runtime.waitingFor}</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

function SessionEditedFilesPanel({
  sessionId,
}: {
  sessionId: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["session-extras", sessionId],
    queryFn: () => fetchSessionExtras(sessionId),
    staleTime: 30_000,
  });
  const [order, setOrder] = useState<SortOrder>("desc");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  if (isLoading) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        로딩 중…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        편집 파일을 불러오지 못했습니다.
      </div>
    );
  }
  if (data.editedFiles.length === 0) {
    return <EmptyState>이 세션에서 편집된 파일이 없습니다.</EmptyState>;
  }
  // 서브에이전트 필터 + 정렬. 두 셋은 disjoint하게 나눠 합이 전체와 같아지도록 한다.
  // - 메인: 메인이 한 번이라도 만진 파일 (혼합 포함)
  // - 서브에이전트: 서브에이전트만 만진 파일
  const all = data.editedFiles;
  const mainTouched = all.filter((f) => f.sidechainCount < f.count);
  const sideOnly = all.filter((f) => f.sidechainCount === f.count);
  const sourceTab =
    sourceFilter === "main" ? mainTouched : sourceFilter === "side" ? sideOnly : all;
  const items =
    order === "desc"
      ? sourceTab
      : [...sourceTab].sort((a, b) => a.lastAt - b.lastAt);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SourceFilterTabs
          value={sourceFilter}
          onChange={setSourceFilter}
          counts={{ all: all.length, main: mainTouched.length, side: sideOnly.length }}
        />
        <SortToggle order={order} onChange={setOrder} />
      </div>
      <ul className="scroll-thin max-h-[70vh] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
        {items.map((f) => {
          const onlySide = f.sidechainCount === f.count;
          const mixed = f.sidechainCount > 0 && f.sidechainCount < f.count;
          return (
            <li
              key={f.path}
              className={cn(
                "flex items-start gap-3 py-2.5 text-xs",
                // 서브에이전트가 한 번이라도 만진 파일이면 violet 가이드 (다른 뷰의 사이드체인 표시와 일관).
                f.sidechainCount > 0 &&
                  "border-l-2 border-violet-300 pl-3 dark:border-violet-700",
              )}
            >
              <span className="w-32 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                {new Date(f.lastAt).toLocaleString()}
              </span>
              <span className="inline-flex w-14 shrink-0 justify-end tabular-nums">
                <Badge variant="info">
                  <span className="inline-block w-8 text-center tabular-nums">
                    {f.count}회
                  </span>
                </Badge>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                    {f.path}
                  </span>
                  {onlySide && <SidechainBadge />}
                  {mixed && (
                    <Tooltip content={`이 파일은 메인 ${f.count - f.sidechainCount}회 + 서브에이전트 ${f.sidechainCount}회 편집됨.`}>
                      <Badge variant="subagent" className="whitespace-nowrap">
                        서브에이전트 {f.sidechainCount}/{f.count}
                      </Badge>
                    </Tooltip>
                  )}
                </div>
                <div className="truncate text-[10px] text-zinc-500">
                  첫 변경 {new Date(f.firstAt).toLocaleString()}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type SourceFilter = "all" | "main" | "side";

/**
 * 메인 흐름과 서브에이전트를 가르는 작은 탭 UI.
 * 같은 패턴이 편집 파일·대화 패널에서 재사용된다.
 */
function SourceFilterTabs({
  value,
  onChange,
  counts,
}: {
  value: SourceFilter;
  onChange: (v: SourceFilter) => void;
  counts: { all: number; main: number; side: number };
}) {
  const items: { id: SourceFilter; label: string; count: number }[] = [
    { id: "all", label: "전체", count: counts.all },
    { id: "main", label: "메인", count: counts.main },
    { id: "side", label: "서브에이전트", count: counts.side },
  ];
  return (
    <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors",
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
            )}
          >
            <span>{it.label}</span>
            <span
              className={cn(
                "rounded px-1 text-[10px] font-semibold",
                active
                  ? "bg-white/20"
                  : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
              )}
            >
              {it.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 세션 내부 TaskList(또는 레거시 Todo)를 라이브와 이력 두 섹션으로 분리해 보여준다.
 *
 * - 라이브: claude가 지금 디스크에 들고 있는 진행 중 태스크 (`~/.claude/tasks/<sid>/*.json`).
 *   완료/삭제 시 claude가 파일을 지우므로 여기엔 안 남는다.
 * - 이력: 세션 jsonl을 처음부터 재생해 복원한 전체 태스크. 완료된 것 포함.
 *
 * 5초 폴링 + 탭 포커스 시 즉시 갱신.
 */
function SessionTasksPanel({
  sessionId,
  focusTaskId,
}: {
  sessionId: string;
  /** 진입 직후 잠깐 sky 링으로 강조할 태스크 id. 알림 라우팅에서 받음. */
  focusTaskId?: string;
}) {
  const [replayOpen, setReplayOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  /**
   * 알림에서 들어왔을 때 잠깐 강조할 태스크 id. 마운트 시 focusTaskId로 셋팅,
   * ~3초 후 자동 해제. 같은 id로 재진입(URL 변경)하면 다시 강조되도록 effect deps에 포함.
   */
  const [transientFocusId, setTransientFocusId] = useState<string | null>(
    focusTaskId ?? null,
  );
  useEffect(() => {
    if (!focusTaskId) {
      setTransientFocusId(null);
      return;
    }
    setTransientFocusId(focusTaskId);
    const t = setTimeout(() => setTransientFocusId(null), 3000);
    return () => clearTimeout(t);
  }, [focusTaskId]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["session-tasks", sessionId],
    queryFn: () => fetchSessionTasks(sessionId),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  // 리플레이 모드일 때만 events를 fetch.
  const { data: replayData } = useQuery({
    queryKey: ["session-tasks-events", sessionId],
    queryFn: () => fetchSessionTasks(sessionId, true),
    enabled: replayOpen,
    staleTime: 30_000,
  });
  const events = replayData?.events ?? [];
  const isAtEnd = step >= events.length;
  const effectivelyPlaying = playing && !isAtEnd && events.length > 0;
  const visibleTasks = useReplayTasks(events, step);
  const lastEvent = step > 0 ? events[step - 1] ?? null : null;
  const advance = useCallback(() => setStep((s) => s + 1), []);
  useReplayAutoplay(effectivelyPlaying, step, advance);

  const enterReplay = () => {
    setReplayOpen(true);
    setStep(0);
    setPlaying(false);
  };
  const exitReplay = () => {
    setReplayOpen(false);
    setPlaying(false);
  };
  const togglePlay = () => {
    if (isAtEnd) {
      setStep(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };
  const resetReplay = () => {
    setStep(0);
    setPlaying(false);
  };
  const seek = (next: number) => {
    setPlaying(false);
    setStep(next);
  };

  if (isLoading) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        로딩 중…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        태스크 목록을 불러오지 못했습니다.
      </div>
    );
  }
  const history = data?.history ?? [];
  if (history.length === 0) {
    return (
      <EmptyState>
        이 세션에서 관리 중인 태스크가 없습니다. (TaskCreate · TodoWrite 도구가
        사용된 적이 없을 수 있어요)
      </EmptyState>
    );
  }

  // history가 라이브를 포함한 전체이므로 진행률은 history 기준으로 계산.
  const active = history.filter((t) => t.status !== "deleted");
  const completedCount = active.filter((t) => t.status === "completed").length;
  const total = active.length;
  const donePct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          전체 <span className="font-mono tabular-nums">{total}</span>
        </span>
        <span>·</span>
        <span>
          완료{" "}
          <span className="font-mono tabular-nums">
            {completedCount}/{total}
          </span>{" "}
          ({donePct}%)
        </span>
        <div className="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-emerald-500 transition-[width] duration-300"
            style={{ width: `${donePct}%` }}
          />
        </div>
      </div>

      {replayOpen && (
        <SessionTasksReplayControls
          step={step}
          total={events.length}
          playing={playing}
          isAtEnd={isAtEnd}
          onTogglePlay={togglePlay}
          onReset={resetReplay}
          onSeek={seek}
          onExit={exitReplay}
        />
      )}

      <SessionTaskSection
        title={replayOpen ? "현재 상황 (재생 중)" : "현재 상황"}
        hint={
          replayOpen
            ? "이벤트마다 카드가 컬럼 사이를 이동합니다."
            : "세션 로그 재생으로 복원한 전체 태스크 (완료·삭제 포함)."
        }
        tasks={replayOpen ? visibleTasks : history}
        emptyText={
          replayOpen
            ? "재생을 시작하면 카드가 등장합니다."
            : "이력으로 복원할 태스크가 없습니다."
        }
        muted={!replayOpen}
        showDeleted
        action={
          replayOpen ? null : (
            <button
              type="button"
              onClick={enterReplay}
              disabled={history.length === 0}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              title={
                history.length === 0
                  ? "재생할 이력이 없습니다"
                  : "태스크 진행을 처음부터 시각화"
              }
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              <span>리플레이</span>
            </button>
          )
        }
        highlightId={
          replayOpen ? lastEvent?.taskId : (transientFocusId ?? undefined)
        }
      />

      <SessionTaskGraphSection sessionId={sessionId} />
    </div>
  );
}

/**
 * 이력 패널 하단의 위상 정렬 그래프. 별도 탭이 아니라 태스크 패널 안에서 보조 시각화로 노출.
 * 이벤트가 있을 때만 표시 (없으면 그래프 자체가 의미 없음).
 */
function SessionTaskGraphSection({
  sessionId,
}: {
  sessionId: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2 border-b border-zinc-200 pb-1.5 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          그래프
        </h3>
        <span className="ml-1 text-[11px] text-zinc-500">
          태스크 변천을 위상 정렬한 DAG. 노드는 status 변화 시점.
        </span>
      </header>
      <Suspense
        fallback={
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            그래프 로딩 중…
          </div>
        }
      >
        <SessionTaskGraphView sessionId={sessionId} />
      </Suspense>
    </section>
  );
}

function SessionTaskSection({
  title,
  hint,
  tasks,
  emptyText,
  muted,
  showDeleted,
  action,
  highlightId,
}: {
  title: string;
  hint: string;
  tasks: SessionTask[];
  emptyText: string;
  muted?: boolean;
  /** true면 "삭제됨" 컬럼을 추가로 보여준다(이력 섹션 전용). */
  showDeleted?: boolean;
  /** 헤더 우측에 띄울 액션 버튼(리플레이 등). */
  action?: React.ReactNode;
  /** 강조할 카드 id(리플레이 직전 변경분). */
  highlightId?: string;
}) {
  const groups: { status: SessionTask["status"]; label: string }[] = [
    { status: "pending", label: "대기" },
    { status: "in_progress", label: "진행 중" },
    { status: "completed", label: "완료" },
    ...(showDeleted
      ? [{ status: "deleted" as const, label: "삭제됨" }]
      : []),
  ];
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2 border-b border-zinc-200 pb-1.5 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {title}
        </h3>
        <span className="font-mono text-[11px] tabular-nums text-zinc-500">
          {tasks.length}
        </span>
        <span className="ml-1 text-[11px] text-zinc-500">{hint}</span>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {tasks.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-200 px-3 py-4 text-center text-[11px] text-zinc-400 dark:border-zinc-800">
          {emptyText}
        </div>
      ) : (
        <div
          className={cn(
            "grid grid-cols-1 gap-3",
            showDeleted ? "md:grid-cols-4" : "md:grid-cols-3",
            muted && "opacity-90",
          )}
        >
          {groups.map((g) => {
            const items = tasks.filter((t) => t.status === g.status);
            return (
              <div
                key={g.status}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/*
                  본문 ul은 scroll-thin이라 scrollbar-gutter: stable 8px이 우측에 항상 예약된다.
                  헤더에도 동일한 pr-2를 줘서 뱃지의 우측 끝이 카드 우측 끝과 정렬되게 한다.
                */}
                <div className="flex items-center justify-between pr-2">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {g.label}
                  </span>
                  <Badge variant={taskGroupVariant(g.status)}>
                    {items.length}
                  </Badge>
                </div>
                <ul className="scroll-thin flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
                  {items.length === 0 && (
                    <li className="px-1 py-2 text-[11px] text-zinc-400">없음</li>
                  )}
                  {items.map((t) => (
                    <SessionTaskCard
                      key={t.id}
                      task={t}
                      highlight={t.id === highlightId}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function taskGroupVariant(
  status: SessionTask["status"],
): "info" | "warning" | "success" | "danger" | "default" {
  if (status === "in_progress") return "warning";
  if (status === "completed") return "success";
  if (status === "deleted") return "default";
  return "info";
}

function SessionTaskCard({
  task,
  highlight,
}: {
  task: SessionTask;
  /** 리플레이에서 직전 이벤트 대상인 경우 sky 링으로 강조. */
  highlight?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails = Boolean(task.description) || (task.blockedBy?.length ?? 0) > 0;
  const cardRef = useRef<HTMLLIElement>(null);
  /**
   * 알림 클릭으로 highlight=true가 된 카드는 가시 영역 밖에 있을 수 있으므로
   * 마운트(또는 highlight true 전이) 직후 한 번 스크롤. block: "center"로 컬럼 중앙에 위치.
   */
  useEffect(() => {
    if (!highlight) return;
    const el = cardRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  return (
    <li
      ref={cardRef}
      className={cn(
        "rounded-md border border-zinc-200 bg-white p-2.5 text-xs shadow-sm transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-950",
        highlight &&
          "ring-2 ring-inset ring-sky-400/70 dark:ring-sky-500/50",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-block w-6 shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
          #{task.id}
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "font-medium text-zinc-900 dark:text-zinc-100",
              task.status === "deleted" &&
                "text-zinc-500 line-through dark:text-zinc-500",
            )}
          >
            {task.status === "in_progress" && task.activeForm
              ? task.activeForm
              : task.subject}
          </div>
          {task.status === "in_progress" && task.activeForm && (
            <div className="mt-0.5 truncate text-[10px] text-zinc-500">
              {task.subject}
            </div>
          )}
          {hasDetails && open && (
            <div className="mt-1.5 flex flex-col gap-1 text-[11px] text-zinc-600 dark:text-zinc-400">
              {task.description && (
                <p className="whitespace-pre-wrap leading-relaxed">
                  {task.description}
                </p>
              )}
              {task.blockedBy && task.blockedBy.length > 0 && (
                <div className="text-[10px] text-zinc-500">
                  blocked by:{" "}
                  <span className="font-mono">
                    {task.blockedBy.map((id) => `#${id}`).join(", ")}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "접기" : "펼치기"}
            title={open ? "접기" : "펼치기"}
            className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        )}
      </div>
    </li>
  );
}

function SessionConversationPanel({
  sessionId,
}: {
  sessionId: string;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["session-extras", sessionId],
    queryFn: () => fetchSessionExtras(sessionId),
    staleTime: 30_000,
  });
  const [order, setOrder] = useState<SortOrder>("desc");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  if (isLoading) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        로딩 중…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        대화를 불러오지 못했습니다.
      </div>
    );
  }
  if (data.conversation.length === 0) {
    return <EmptyState>이 세션의 대화 기록이 없습니다.</EmptyState>;
  }
  // 시간 순서 번호는 항상 전체 기준. 시퀀스 번호는 서브에이전트을 포함해 매기지만,
  // 필터 후 표시 단계에서만 항목을 가린다.
  const total = data.conversation.length;
  const numbered = data.conversation.map((t, i) => ({
    turn: t,
    seq: total - i,
  }));
  const allCount = numbered.length;
  const mainCount = numbered.filter((x) => !x.turn.sidechain).length;
  const sideCount = allCount - mainCount;
  const filtered = numbered.filter((x) => {
    if (sourceFilter === "main") return !x.turn.sidechain;
    if (sourceFilter === "side") return x.turn.sidechain;
    return true;
  });
  const ordered = order === "desc" ? filtered : [...filtered].reverse();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <SourceFilterTabs
          value={sourceFilter}
          onChange={setSourceFilter}
          counts={{ all: allCount, main: mainCount, side: sideCount }}
        />
        <SortToggle order={order} onChange={setOrder} />
      </div>
      <ol className="scroll-thin flex max-h-[75vh] flex-col divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-900">
        {ordered.map(({ turn: t, seq }) => (
          <li
            key={`${t.timestamp}-${seq}`}
            className={cn(
              "flex gap-3 py-4 first:pt-0",
              // 서브에이전트 턴은 살짝 들여쓰고 좌측에 violet 가이드 라인.
              t.sidechain &&
                "border-l-2 border-violet-300 pl-3 dark:border-violet-700",
            )}
          >
            <span className="w-32 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
              {t.timestamp > 0 ? new Date(t.timestamp).toLocaleString() : "—"}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <Tooltip
                  content={
                    t.role === "user"
                      ? "사용자가 입력한 프롬프트(턴 시작점)."
                      : "어시스턴트의 텍스트 응답. 도구 호출이 있으면 같이 표시됨."
                  }
                >
                  <span>
                    <Badge variant={t.role === "user" ? "default" : "info"}>
                      {t.role === "user" ? "사용자" : "어시스턴트"}
                    </Badge>
                  </span>
                </Tooltip>
                {t.sidechain && <SidechainBadge />}
                <span className="font-mono">#{seq}</span>
              </div>
              {t.text && <SessionMarkdown text={t.text} />}
              {t.toolCalls && t.toolCalls.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-[10px] text-zinc-600 dark:text-zinc-400">
                  {t.toolCalls.map((c, j) => (
                    <li
                      key={j}
                      className="flex items-center gap-2 truncate font-mono"
                    >
                      <span className="text-sky-600 dark:text-sky-400">↳</span>
                      <span className="font-semibold">{c.name}</span>
                      {c.filePath && (
                        <span className="truncate text-zinc-500">
                          {c.filePath}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}


function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

/**
 * 새 세션 실행 버튼. 본문 클릭은 즉시 실행, 캐럿 클릭은 드롭다운으로 "프롬프트 입력" 선택.
 * 프롬프트 옵션을 누르면 작은 모달이 열려 시작 프롬프트를 입력받는다.
 */
function LaunchSplitButton({
  projectId,
  isLaunching,
  onLaunchImmediate,
  onLaunchIgnoringDefault,
  onLaunchWithPrompt,
}: {
  /** 활성 프로젝트 id (ALL 제외 보장 — 호출자 책임). */
  projectId: string;
  /** 진행 중 여부. 모든 버튼 disabled 처리. */
  isLaunching: boolean;
  /** 즉시 실행. 설정의 기본 프롬프트가 있으면 그대로 사용. */
  onLaunchImmediate: () => void;
  /** 즉시 실행하되 설정의 기본 프롬프트를 무시. 빈 세션. */
  onLaunchIgnoringDefault: () => void;
  /** 사용자가 입력한 프롬프트로 실행. 설정의 기본 프롬프트와 줄바꿈으로 합쳐짐. */
  onLaunchWithPrompt: (prompt: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function handlePromptSubmit() {
    if (!prompt.trim()) return;
    onLaunchWithPrompt(prompt);
    setPrompt("");
    setPromptOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={onLaunchImmediate}
        disabled={isLaunching}
        aria-label="즉시 실행"
        title={`${projectId}에서 새 Claude 세션을 즉시 실행합니다.`}
        className="inline-flex h-7 items-center gap-1 rounded-l-md border border-zinc-900 bg-zinc-900 px-2 text-xs text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        <span>{isLaunching ? "실행 중…" : "생성"}</span>
      </button>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={isLaunching}
        aria-label="실행 옵션"
        title="실행 옵션"
        className="-ml-px inline-flex h-7 items-center justify-center rounded-r-md border border-zinc-900 bg-zinc-900 px-1.5 text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-8 z-30 w-64 overflow-hidden rounded-md border border-zinc-200 bg-white text-xs shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onLaunchImmediate();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>즉시 실행</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onLaunchIgnoringDefault();
            }}
            className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 dark:border-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>즉시 실행 (기본 프롬프트 무시)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setPromptOpen(true);
            }}
            className="flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-zinc-700 hover:bg-zinc-100 dark:border-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>프롬프트 입력</span>
          </button>
        </div>
      )}

      <Modal
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        title="시작 프롬프트로 새 세션 실행"
        size="md"
      >
        <div className="flex flex-col gap-3">
          <Field
            label="시작 프롬프트"
            hint="설정의 기본 프롬프트가 있으면 줄바꿈으로 함께 전달됩니다."
            required
          >
            <textarea
              autoFocus
              className={cn(inputBaseClass, "min-h-32 font-mono text-xs")}
              placeholder="예: 이 저장소를 한 단락으로 요약해줘."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handlePromptSubmit();
                }
              }}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPromptOpen(false)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              <span>취소</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handlePromptSubmit}
              disabled={!prompt.trim() || isLaunching}
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              <span>{isLaunching ? "실행 중…" : "실행"}</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

