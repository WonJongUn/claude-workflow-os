import type { TicketPriority, TicketStatus } from "@/lib/types";
import type { BadgeVariant } from "./ui";

export const PRIORITY_VARIANT: Record<TicketPriority, BadgeVariant> = {
  low: "default",
  medium: "info",
  high: "danger",
};

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "열림",
  IN_PROGRESS: "진행 중",
  REVIEW: "검토",
  DONE: "완료",
  CANCELLED: "취소",
};

export const BOARD_COLUMNS: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
];
