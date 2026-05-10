"use client";

import { useEffect } from "react";
import { useNotify } from "./notifications";
import { subscribeSse } from "./sse-bus";
import type { SessionTaskNotification } from "@/lib/session-watcher";

/**
 * 세션 jsonl 변화를 SSE로 구독해 TaskCreate/TaskUpdate 발생 시 토스트로 띄운다.
 * NotificationProvider 안에 항상 마운트되어 있어야 한다.
 *
 * - 새로고침/탐색 사이에도 살아 있도록 layout 레벨에 둔다.
 * - 서버측 watcher가 *재시작 직후 파일 끝* 부터 추적하므로, 이 클라가 처음 연결할 때
 *   과거 누적 알림이 한꺼번에 쏟아지지 않는다.
 */
export function SessionTaskNotifier() {
  const notify = useNotify();
  useEffect(() => {
    return subscribeSse<SessionTaskNotification>("session-task", (data) => {
      notify({
        level: data.kind === "create" ? "info" : levelOf(data.status),
        category: "task",
        title: titleOf(data),
        detail: detailOf(data),
        href: hrefOf(data),
      });
    });
  }, [notify]);
  return null;
}

function titleOf(n: SessionTaskNotification): string {
  if (n.kind === "create") return "태스크 생성";
  if (n.status) return `태스크 → ${labelOfStatus(n.status)}`;
  return "태스크 변경";
}

/**
 * 두 줄 detail.
 * 1줄: 태스크 식별 (#id 제목)
 * 2줄: 세션 정보 — 시각 스캔에 방해되지 않게 다음 줄로.
 *
 * 표시 측에서는 whitespace-pre-line으로 \n을 줄바꿈으로 보존.
 */
function detailOf(n: SessionTaskNotification): string {
  const head = n.taskId ? `#${n.taskId}` : "";
  const body = n.subject ? n.subject : "";
  const sep = head && body ? " " : "";
  const taskLine = `${head}${sep}${body}`.trim();
  const sessionLine = n.sessionId ? `세션 ${shortId(n.sessionId)}` : "";
  return [taskLine, sessionLine].filter(Boolean).join("\n");
}

/**
 * 알림 클릭 시 세션 상세 + 태스크 탭 활성으로 가는 경로.
 * taskId가 있으면 진입 시 해당 카드를 잠깐 강조하기 위해 쿼리에 같이 전달.
 */
function hrefOf(n: SessionTaskNotification): string {
  const base = `/sessions/${encodeURIComponent(n.sessionId)}?tab=tasks`;
  return n.taskId ? `${base}&taskId=${encodeURIComponent(n.taskId)}` : base;
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function labelOfStatus(s: NonNullable<SessionTaskNotification["status"]>): string {
  if (s === "in_progress") return "진행 중";
  if (s === "completed") return "완료";
  if (s === "deleted") return "삭제";
  return "대기";
}

function levelOf(
  s: SessionTaskNotification["status"],
): "info" | "success" | "error" {
  if (s === "completed") return "success";
  if (s === "deleted") return "error";
  return "info";
}
