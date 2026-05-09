import type { TicketPriority, TicketStatus } from "@/lib/types";
import type { BadgeVariant } from "./ui";

/**
 * 티켓 우선순위 → Badge variant. UI 프리미티브가 도메인을 모르도록 매핑을 한 곳에 모은다.
 * TicketCard와 보드 헤더에서 소비.
 */
export const PRIORITY_VARIANT: Record<TicketPriority, BadgeVariant> = {
  low: "default",
  medium: "info",
  high: "danger",
};

/**
 * 티켓 상태 → 한국어 표시 라벨. 컬럼 헤더, 카드, 알림에서 공통 사용.
 * 새 상태가 추가되면 여기에도 반드시 추가해야 빌드가 통과한다 (Record 강제).
 */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "열림",
  IN_PROGRESS: "진행 중",
  REVIEW: "검토",
  DONE: "완료",
  CANCELLED: "취소",
};

/**
 * 보드에 표시되는 컬럼 순서. CANCELLED는 의도적으로 제외 (목록에서 숨김).
 * 사용자가 보드에서 보고 싶지 않은 종료 상태이므로 별도 필터/뷰에서만 노출.
 */
export const BOARD_COLUMNS: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
];
