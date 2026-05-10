/** 알림 시각/의미 레벨. 토스트 색·아이콘과 사운드 결정. */
export type NotificationLevel = "success" | "error" | "info" | "warning";

/**
 * 알림 도메인 분류. 패널의 카테고리 탭 필터링과 라벨 표시에 쓰인다.
 * - "task": Claude Code 세션의 TaskCreate/TaskUpdate 이벤트.
 * - "session": 세션 실행/이어가기/삭제 등 세션 라이프사이클.
 * - "ticket": 티켓 생성·전이·차단 토글.
 * - "project": 프로젝트/에이전트/스킬 CRUD.
 * - "settings": 앱 설정 저장.
 * - "system": 카테고리 미지정 또는 시스템 메시지 (마이그레이션 fallback).
 */
export type NotificationCategory =
  | "task"
  | "session"
  | "ticket"
  | "project"
  | "settings"
  | "system";

/** 알림 한 건. 도메인 훅(useNotify)이 만들고 ToastStack/NotificationBell이 렌더. */
export type Notification = {
  /** 자동 생성 식별자. */
  id: string;
  /** 레벨에 따라 색·아이콘이 결정된다. */
  level: NotificationLevel;
  /** 도메인 분류. 패널 탭 필터링에 사용. */
  category: NotificationCategory;
  /** 한 줄 요약. */
  title: string;
  /** 보조 설명 (선택). */
  detail?: string;
  /** 클릭 시 이동할 in-app 경로. 있으면 토스트·히스토리 항목이 next/Link 처럼 이동시킨다. */
  href?: string;
  /** 생성 시각 (epoch ms). */
  createdAt: number;
};

/**
 * 카테고리 탭/뱃지 표시용 한글 라벨.
 * "전체"는 탭 컴포넌트가 별도로 추가 (도메인 카테고리가 아님).
 */
export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  task: "태스크",
  session: "세션",
  ticket: "티켓",
  project: "프로젝트",
  settings: "설정",
  system: "시스템",
};

/**
 * 패널 탭 노출 순서. "전체"를 제외한 도메인 카테고리만.
 * 자주 사용/실시간성이 높은 순으로 배치.
 */
export const CATEGORY_ORDER: readonly NotificationCategory[] = [
  "task",
  "session",
  "ticket",
  "project",
  "settings",
  "system",
];
