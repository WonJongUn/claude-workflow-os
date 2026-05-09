"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ClaudeContext, ContextEntry } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  Modal,
  RefreshControl,
  cn,
} from "./ui";
import { useDeleteEntry, useProjectContext } from "./use-projects";
import { EntryEditor } from "./EntryEditor";
import type { EntryKind } from "./project-client";

type ContextPanelProps = {
  /** 컨텍스트를 읽을 프로젝트 id. */
  projectId: string;
};

type EditorState =
  | { mode: "create"; kind: EntryKind }
  | { mode: "edit"; kind: EntryKind; entry: ContextEntry }
  | null;

/**
 * 활성 프로젝트의 .claude 디렉토리 정보 + 에이전트/스킬 CRUD.
 */
export function ContextPanel({ projectId }: ContextPanelProps) {
  const { context, isLoading, isFetching, refetch, dataUpdatedAt } =
    useProjectContext(projectId);
  const [viewing, setViewing] = useState<ContextEntry | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    kind: EntryKind;
    entry: ContextEntry;
  } | null>(null);
  const { remove, isPending: isDeleting } = useDeleteEntry();

  function confirmDelete() {
    if (!pendingDelete) return;
    remove(
      { projectId, kind: pendingDelete.kind, name: pendingDelete.entry.name },
      { onSuccess: () => setPendingDelete(null) },
    );
  }

  return (
    <Card>
      <CardHeader className="items-start">
        <div className="min-w-0 flex-1">
          <CardTitle>컨텍스트</CardTitle>
          {context && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-500">
              {context.projectRoot}
            </div>
          )}
        </div>
        <RefreshControl
          onClick={refetch}
          isFetching={isFetching}
          timestamp={dataUpdatedAt}
        />
      </CardHeader>
      <CardBody>
        {isLoading || !context ? (
          <EmptyState>로딩 중…</EmptyState>
        ) : (
          <ContextSections
            ctx={context}
            onView={setViewing}
            onCreate={(kind) => setEditor({ mode: "create", kind })}
            onEdit={(kind, entry) => setEditor({ mode: "edit", kind, entry })}
            onRequestDelete={(kind, entry) =>
              setPendingDelete({ kind, entry })
            }
          />
        )}
      </CardBody>

      <ContextViewer entry={viewing} onClose={() => setViewing(null)} />

      {editor && (
        <EntryEditor
          key={
            editor.mode === "edit"
              ? `edit:${editor.kind}:${editor.entry.name}`
              : `create:${editor.kind}`
          }
          open={true}
          onClose={() => setEditor(null)}
          projectId={projectId}
          kind={editor.kind}
          initialName={editor.mode === "edit" ? editor.entry.name : undefined}
          initialBody={editor.mode === "edit" ? editor.entry.body : undefined}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="삭제 확인"
        message={
          pendingDelete
            ? `"${pendingDelete.entry.name}" 파일이 삭제됩니다. 계속하시겠습니까?`
            : ""
        }
        confirmLabel={isDeleting ? "삭제 중…" : "삭제"}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Card>
  );
}

type ContextSectionsProps = {
  /** 표시할 컨텍스트 데이터. */
  ctx: ClaudeContext;
  /** 항목 클릭(미리보기) 시 호출. */
  onView: (entry: ContextEntry) => void;
  /** "+ 추가" 클릭 시 호출. */
  onCreate: (kind: EntryKind) => void;
  /** 편집 액션. */
  onEdit: (kind: EntryKind, entry: ContextEntry) => void;
  /** 삭제 요청. */
  onRequestDelete: (kind: EntryKind, entry: ContextEntry) => void;
};

function ContextSections({
  ctx,
  onView,
  onCreate,
  onEdit,
  onRequestDelete,
}: ContextSectionsProps) {
  return (
    <div className="flex flex-col gap-4">
      <Section title="CLAUDE.md">
        {ctx.claudeMd ? (
          <button
            type="button"
            onClick={() => onView(ctx.claudeMd!)}
            className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-900"
          >
            있음 →
          </button>
        ) : (
          <Badge variant="warning">없음</Badge>
        )}
      </Section>

      <Section
        title={`에이전트 (${ctx.agents.length})`}
        action={
          <Button size="sm" variant="ghost" onClick={() => onCreate("agent")}>
            <Plus className="mr-0.5 h-3.5 w-3.5" aria-hidden />추가
          </Button>
        }
      >
        <EntryList
          entries={ctx.agents}
          onView={onView}
          onEdit={(e) => onEdit("agent", e)}
          onDelete={(e) => onRequestDelete("agent", e)}
        />
      </Section>

      <Section
        title={`스킬 (${ctx.skills.length})`}
        action={
          <Button size="sm" variant="ghost" onClick={() => onCreate("skill")}>
            <Plus className="mr-0.5 h-3.5 w-3.5" aria-hidden />추가
          </Button>
        }
      >
        <EntryList
          entries={ctx.skills}
          onView={onView}
          onEdit={(e) => onEdit("skill", e)}
          onDelete={(e) => onRequestDelete("skill", e)}
        />
      </Section>

      <Section title="규칙 (settings.json)">
        {ctx.rules ? (
          <button
            type="button"
            onClick={() =>
              onView({
                name: "settings.json",
                path: ctx.rules!.path,
                body: prettySettings(ctx.rules!.body),
              })
            }
            className="flex w-full flex-col gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
          >
            <RulesSummary rules={ctx.rules} />
            <span className="text-[11px] text-zinc-500">전체 보기 →</span>
          </button>
        ) : (
          <Badge variant="warning">settings.json 없음</Badge>
        )}
      </Section>
    </div>
  );
}

type EntryListProps = {
  /** 표시할 항목들. */
  entries: ContextEntry[];
  /** 본문 미리보기 (이름 클릭). */
  onView: (entry: ContextEntry) => void;
  /** 편집 액션. */
  onEdit: (entry: ContextEntry) => void;
  /** 삭제 요청. */
  onDelete: (entry: ContextEntry) => void;
};

function EntryList({ entries, onView, onEdit, onDelete }: EntryListProps) {
  if (entries.length === 0) return <EmptyState>없음</EmptyState>;
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li
          key={entry.path}
          className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          <button
            type="button"
            onClick={() => onView(entry)}
            className="flex-1 truncate text-left text-zinc-800 hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
          >
            {entry.name}
          </button>
          <button
            type="button"
            onClick={() => onEdit(entry)}
            className={iconBtn}
            aria-label={`${entry.name} 수정`}
            title="수정"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onDelete(entry)}
            className={cn(iconBtn, "hover:text-red-600 dark:hover:text-red-400")}
            aria-label={`${entry.name} 삭제`}
            title="삭제"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

const iconBtn =
  "rounded p-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100";

function RulesSummary({ rules }: { rules: NonNullable<ClaudeContext["rules"]> }) {
  return (
    <div className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
      <div>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          권한:
        </span>{" "}
        {summarizeRecord(rules.permissions)}
      </div>
      <div>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          훅:
        </span>{" "}
        {summarizeHooks(rules.hooks)}
      </div>
    </div>
  );
}

function summarizeHooks(hooks: unknown): string {
  if (!hooks || typeof hooks !== "object") return "—";
  const entries = Object.entries(hooks as Record<string, unknown>);
  if (entries.length === 0) return "—";
  return entries
    .map(([event, list]) => {
      const count = Array.isArray(list) ? list.length : 1;
      return `${event}(${count})`;
    })
    .join(", ");
}

function prettySettings(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function ContextViewer({
  entry,
  onClose,
}: {
  entry: ContextEntry | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      title={entry?.name ?? ""}
      size="xl"
    >
      {entry && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-500">
              {entry.path}
            </span>
            <span className="shrink-0 text-[11px] text-zinc-500">
              {countLines(entry.body)}줄
            </span>
          </div>
          <CodeView body={entry.body} />
        </>
      )}
    </Modal>
  );
}

function CodeView({ body }: { body: string }) {
  if (!body) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        (빈 파일)
      </div>
    );
  }
  const lines = body.split("\n");
  return (
    <div className="scroll-thin max-h-[60vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 font-mono text-xs leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className="align-top">
              <td className="sticky left-0 select-none border-r border-zinc-200 bg-zinc-100/80 px-3 py-0.5 text-right text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-600">
                {i + 1}
              </td>
              <td className="whitespace-pre-wrap break-words px-3 py-0.5">
                {line || " "}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  /** 섹션 제목. */
  title: string;
  /** 우측 액션 (예: 추가 버튼). */
  action?: React.ReactNode;
  /** 본문. */
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          {title}
        </h4>
        {action}
      </div>
      {children}
    </div>
  );
}

function countLines(body: string): number {
  if (!body) return 0;
  return body.split("\n").length;
}

function summarizeRecord(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return "—";
  return keys.join(", ");
}
