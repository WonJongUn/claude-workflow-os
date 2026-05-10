"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Ticket, TicketStatus } from "@/lib/types";
import { ConfirmDialog, Modal } from "./ui";
import { BOARD_COLUMNS, STATUS_LABEL } from "./ticket-meta";
import { TicketColumn } from "./TicketColumn";
import { NewTicketForm } from "./NewTicketForm";
import { WorkerLogPanel } from "./WorkerLogPanel";
import {
  useAnswerTicket,
  useDeleteTicket,
  useTicketTransition,
  useTickets,
} from "./use-tickets";
import { useProjects } from "./use-projects";

/** Ticket → NewTicketForm 폼 초기값. id/상태/타임스탬프 등 비편집 메타는 제외. */
function ticketToFormInitial(t: Ticket) {
  return {
    title: t.title,
    agent: t.agent ?? "",
    goal: t.goal,
    background: t.background ?? "",
    priority: t.priority,
    requirements: t.requirements,
    acceptance_criteria: t.acceptance_criteria,
    references: t.references ?? [],
    projectId: t.projectId ?? "",
  };
}

/** 보드 그룹핑 모드. URL `?view=`가 진실 원천이며 페이지에서 내려준다. */
export type BoardViewMode = "project" | "state" | "session";

type TicketBoardProps = {
  /**
   * 활성 프로젝트 id로 티켓을 필터링. "ALL" 또는 미지정이면 전체 모음에 적용.
   * 진실 원천은 URL `?project=<id>`.
   */
  activeProjectId?: string;
  /**
   * 섹션 그룹핑 기준.
   * - `project`: 프로젝트별 (ALL일 때 디바이더 분리, 특정 프로젝트면 단일 섹션)
   * - `state`: 워커 진행 상태별 (큐 대기 / 워커 실행 / 사용자 대기 / 완료 / 차단 / 기타)
   * - `session`: 워커 세션 id별 (currentSessionId 공유 묶음)
   */
  viewMode?: BoardViewMode;
};

/**
 * 칸반보드. ALL 뷰는 프로젝트별 섹션 + 디바이더로 분리, 특정 프로젝트 뷰는 단일 4컬럼.
 * 데이터·변경은 도메인 훅으로 위임. URL `?ticket=<id>`가 모달 열림 단일 진실 원천.
 */
export function TicketBoard({
  activeProjectId,
  viewMode = "project",
}: TicketBoardProps = {}) {
  const [error, setError] = useState<string | null>(null);
  const { tickets: allTickets } = useTickets();
  const { projects } = useProjects();
  const { transition } = useTicketTransition();
  const { answer } = useAnswerTicket();
  const { remove: deleteTicket } = useDeleteTicket();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeId = searchParams.get("ticket");
  const [duplicateSource, setDuplicateSource] = useState<Ticket | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Ticket | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const isAllView = !activeProjectId || activeProjectId === "ALL";
  const visibleTickets = useMemo(() => {
    if (isAllView) return allTickets;
    return allTickets.filter((t) => t.projectId === activeProjectId);
  }, [allTickets, activeProjectId, isAllView]);

  const sections = useMemo(
    () => buildSections(visibleTickets, projects, isAllView, viewMode),
    [visibleTickets, projects, isAllView, viewMode],
  );
  // state/session 뷰는 항상 섹션 헤더(라벨/건수)를 보여준다 — 단일 섹션이라도 분류 의미가 있으므로.
  const showSectionHeaders = viewMode !== "project" || isAllView;

  const activeTicket = activeId
    ? (allTickets.find((t) => t.id === activeId) ?? null)
    : null;

  function setActiveId(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set("ticket", id);
    else params.delete("ticket");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function closeEdit() {
    setEditError(null);
    setActiveId(null);
  }

  function closeDuplicate() {
    setDuplicateError(null);
    setDuplicateSource(null);
  }

  function onTransition(id: string, next: TicketStatus) {
    transition(id, next, { onError: setError });
  }

  // 5px 이상 이동해야 드래그로 인식 — 클릭(편집 모달 열기)과 충돌 방지.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function onDragEnd(ev: DragEndEvent) {
    if (!ev.over) return;
    const ticketId = String(ev.active.id);
    // droppableId는 `${sectionKey}:${status}` — 섹션 충돌 방지를 위한 복합 키. status만 추출.
    const overId = String(ev.over.id);
    const colonIdx = overId.lastIndexOf(":");
    if (colonIdx < 0) return;
    const targetStatus = overId.slice(colonIdx + 1) as TicketStatus;
    const ticket = allTickets.find((t) => t.id === ticketId);
    if (!ticket || ticket.status === targetStatus) return;

    // REVIEW → IN_PROGRESS는 사용자 답변이 남아 있으면 차단 — 답변을 먼저 보내야 한다.
    if (
      ticket.status === "REVIEW" &&
      targetStatus === "IN_PROGRESS" &&
      ticket.pendingQuestion
    ) {
      setError(
        "검토 중인 질문에 답변을 먼저 입력하세요. 답변 없이는 진행 중으로 되돌릴 수 없습니다.",
      );
      return;
    }
    onTransition(ticketId, targetStatus);
  }

  function onAnswer(id: string, text: string) {
    answer(id, text, { onError: setError });
  }


  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {sections.map((section, idx) => (
        <section key={section.key} className="flex flex-col gap-3">
          {showSectionHeaders && (
            <div
              className={
                idx > 0
                  ? "flex items-baseline gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
                  : "flex items-baseline gap-2"
              }
            >
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {section.label}
              </h2>
              <span className="text-xs text-zinc-500">
                {section.tickets.length}건
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            {BOARD_COLUMNS.map((status) => (
              <TicketColumn
                key={status}
                title={STATUS_LABEL[status]}
                droppableId={`${section.key}:${status}`}
                tickets={section.byStatus[status]}
                onTransition={onTransition}
                onAnswer={onAnswer}
                onOpen={setActiveId}
                onDuplicate={setDuplicateSource}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        </section>
      ))}

      <Modal
        open={activeTicket !== null}
        onClose={closeEdit}
        title={activeTicket ? `${activeTicket.id} 편집` : "티켓 편집"}
        size="lg"
      >
        {editError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {editError}
          </div>
        )}
        {activeTicket && (
          <>
            <WorkerLogPanel
              ticketId={activeTicket.id}
              currentSessionId={activeTicket.currentSessionId}
              workerLog={activeTicket.workerLog}
            />
            <NewTicketForm
              key={activeTicket.id}
              initial={ticketToFormInitial(activeTicket)}
              editingId={activeTicket.id}
              onClose={closeEdit}
              onError={setEditError}
            />
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="티켓 삭제"
        message={
          deleteTarget ? (
            <div className="flex flex-col gap-1 text-sm">
              <div>
                <span className="font-mono text-xs">{deleteTarget.id}</span> ·{" "}
                {deleteTarget.title}
              </div>
              <div className="text-xs text-zinc-500">
                삭제하면 복구할 수 없습니다.
              </div>
            </div>
          ) : null
        }
        confirmLabel="삭제"
        variant="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          deleteTicket(deleteTarget.id, {
            onSuccess: () => {
              if (activeId === deleteTarget.id) setActiveId(null);
              setDeleteTarget(null);
            },
            onError: () => setDeleteTarget(null),
          });
        }}
      />

      <Modal
        open={duplicateSource !== null}
        onClose={closeDuplicate}
        title={duplicateSource ? `${duplicateSource.id} 복제` : "티켓 복제"}
        size="lg"
      >
        {duplicateError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {duplicateError}
          </div>
        )}
        {duplicateSource && (
          <NewTicketForm
            key={`dup-${duplicateSource.id}`}
            initial={ticketToFormInitial(duplicateSource)}
            onClose={closeDuplicate}
            onError={setDuplicateError}
          />
        )}
      </Modal>
    </div>
    </DndContext>
  );
}

type Section = {
  /** 섹션 식별 key. 프로젝트 id 또는 "_unassigned" 또는 "_single". */
  key: string;
  /** 헤더 라벨. 단일 프로젝트 뷰일 때도 fallback으로 사용. */
  label: string;
  /** 이 섹션에 속하는 티켓들. */
  tickets: Ticket[];
  /** 상태별로 미리 그룹된 결과. 컬럼 렌더용. */
  byStatus: Record<TicketStatus, Ticket[]>;
};

/**
 * 보드 섹션 빌드. viewMode에 따라 그룹핑 기준이 다르다:
 * - project: 프로젝트별 (ALL이면 전 프로젝트, 아니면 단일)
 * - state: 워커 진행 상태별 (큐 대기 / 워커 실행 / 사용자 대기 / 완료 / 차단 / 미지정)
 * - session: workerSessionId 공유 묶음 + (세션 없음)
 */
function buildSections(
  tickets: Ticket[],
  projects: { id: string; name: string }[],
  isAllView: boolean,
  viewMode: BoardViewMode,
): Section[] {
  if (viewMode === "state") return buildStateSections(tickets);
  if (viewMode === "session") return buildSessionSections(tickets);

  if (!isAllView) {
    return [
      {
        key: "_single",
        label: "",
        tickets,
        byStatus: groupByStatus(tickets),
      },
    ];
  }

  const userProjects = projects.filter((p) => p.id !== "ALL");
  const byProject = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const key = t.projectId ?? "_unassigned";
    const list = byProject.get(key) ?? [];
    list.push(t);
    byProject.set(key, list);
  }

  const sections: Section[] = [];
  for (const p of userProjects) {
    const list = byProject.get(p.id) ?? [];
    sections.push({
      key: p.id,
      label: p.name,
      tickets: list,
      byStatus: groupByStatus(list),
    });
  }
  // 알려지지 않은 projectId 또는 미지정 — 한 섹션으로 모은다.
  const orphan: Ticket[] = [];
  for (const [k, list] of byProject.entries()) {
    if (k === "_unassigned" || !userProjects.some((p) => p.id === k)) {
      orphan.push(...list);
    }
  }
  if (orphan.length > 0) {
    sections.push({
      key: "_unassigned",
      label: "(미지정 프로젝트)",
      tickets: orphan,
      byStatus: groupByStatus(orphan),
    });
  }
  return sections;
}

/** 워커 진행 상태별 섹션. 한 티켓은 정확히 한 그룹에 속한다. */
const STATE_BUCKETS = [
  { key: "blocked", label: "차단됨" },
  { key: "pending_question", label: "사용자 답변 대기" },
  { key: "pending_approval", label: "사용자 승인 대기" },
  { key: "running", label: "워커 실행 중" },
  { key: "queued", label: "큐 대기" },
  { key: "done", label: "완료" },
  { key: "cancelled", label: "취소" },
  { key: "idle", label: "기타" },
] as const;

function bucketOf(t: Ticket): (typeof STATE_BUCKETS)[number]["key"] {
  if (t.blocked) return "blocked";
  if (t.pendingQuestion) return "pending_question";
  if (t.pendingApproval) return "pending_approval";
  if (t.status === "IN_PROGRESS" && t.currentSessionId) return "running";
  if (t.status === "OPEN" && t.projectId) return "queued";
  if (t.status === "DONE") return "done";
  if (t.status === "CANCELLED") return "cancelled";
  return "idle";
}

function buildStateSections(tickets: Ticket[]): Section[] {
  const groups = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = bucketOf(t);
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }
  const sections: Section[] = [];
  for (const b of STATE_BUCKETS) {
    const list = groups.get(b.key) ?? [];
    if (list.length === 0) continue;
    sections.push({
      key: `_state_${b.key}`,
      label: b.label,
      tickets: list,
      byStatus: groupByStatus(list),
    });
  }
  return sections;
}

/** 워커 세션 id별 섹션. currentSessionId가 같은 티켓 묶음 + (세션 없음). */
function buildSessionSections(tickets: Ticket[]): Section[] {
  const bySession = new Map<string, Ticket[]>();
  for (const t of tickets) {
    const k = t.currentSessionId ?? "_no_session";
    const list = bySession.get(k) ?? [];
    list.push(t);
    bySession.set(k, list);
  }
  // 세션 있는 묶음을 먼저(최근 갱신 순), 그 뒤에 세션 없음.
  const withSession = Array.from(bySession.entries())
    .filter(([k]) => k !== "_no_session")
    .sort(([, a], [, b]) => latestUpdated(b) - latestUpdated(a));
  const noSession = bySession.get("_no_session");

  const sections: Section[] = [];
  for (const [sid, list] of withSession) {
    const short = `${sid.slice(0, 8)}…`;
    sections.push({
      key: `_session_${sid}`,
      label: `세션 ${short} · ${list.length}건`,
      tickets: list,
      byStatus: groupByStatus(list),
    });
  }
  if (noSession && noSession.length > 0) {
    sections.push({
      key: "_session_none",
      label: "(세션 없음)",
      tickets: noSession,
      byStatus: groupByStatus(noSession),
    });
  }
  return sections;
}

function latestUpdated(tickets: Ticket[]): number {
  let max = 0;
  for (const t of tickets) {
    const ts = Date.parse(t.updated_at);
    if (Number.isFinite(ts) && ts > max) max = ts;
  }
  return max;
}

function groupByStatus(tickets: Ticket[]): Record<TicketStatus, Ticket[]> {
  const map: Record<TicketStatus, Ticket[]> = {
    OPEN: [],
    IN_PROGRESS: [],
    REVIEW: [],
    DONE: [],
    CANCELLED: [],
  };
  for (const t of tickets) map[t.status].push(t);
  return map;
}
