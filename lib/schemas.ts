import { z } from "zod";
import type { TicketDraft, TicketStatus } from "./types";

/** 티켓 상태 머신. CLAUDE.md "도메인 모델"의 전이 규약을 따른다. */
export const TicketStatusSchema = z.enum([
  "OPEN",
  "IN_PROGRESS",
  "REVIEW",
  "DONE",
  "CANCELLED",
]) satisfies z.ZodType<TicketStatus>;

/** 보드 정렬과 알림 임계값에 사용. */
export const TicketPrioritySchema = z.enum(["low", "medium", "high"]);

/** 새 티켓 생성 또는 부분 갱신 요청 본문. */
export const TicketDraftSchema = z.object({
  /** 클라이언트가 제안하는 id. 미지정 시 서버가 발급. */
  id: z.string().optional(),
  /** 사용자에게 표시되는 한 줄 요약. */
  title: z.string().min(1),
  /** 담당 에이전트 슬러그. 미지정 시 라우팅에서 결정. */
  agent: z.string().optional(),
  /** 무엇을, 왜 해야 하는지 한 단락 이상. */
  goal: z.string().min(1),
  /** 배경 설명. 의사결정 맥락이나 관련 이슈 링크. */
  background: z.string().optional(),
  /** 충족해야 할 기능적 요건 목록. */
  requirements: z.array(z.string()).default([]),
  /** 완료 판정 기준 목록. */
  acceptance_criteria: z.array(z.string()).default([]),
  /** 외부 자료/링크. */
  references: z.array(z.string()).optional(),
  /** 우선순위. 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPrioritySchema,
  /** 초기 상태. 미지정 시 OPEN. */
  status: TicketStatusSchema.optional(),
  /** 생성 시점에 차단 상태로 시작할지. */
  blocked: z.boolean().optional(),
}) satisfies z.ZodType<TicketDraft>;

/** PATCH `/api/tickets/[id]`의 상태 전이 본문. */
export const TransitionBodySchema = z.object({
  /** 다음 상태. 불법 전이는 라우트가 409로 거절. */
  transition: TicketStatusSchema,
});

/** PATCH `/api/tickets/[id]`의 blocked 토글 본문. */
export const BlockedBodySchema = z.object({
  /** 새 차단 여부. */
  blocked: z.boolean(),
  /** blocked=true일 때만 의미가 있는 사유. */
  reason: z.string().optional(),
});

/** PATCH `/api/tickets/[id]`의 일반 필드 갱신 본문. */
export const TicketUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  agent: z.string().optional(),
  goal: z.string().min(1).optional(),
  background: z.string().optional(),
  requirements: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
  references: z.array(z.string()).optional(),
  priority: TicketPrioritySchema.optional(),
  blocked: z.boolean().optional(),
  /** blocked=true일 때 사유. blocked가 false로 바뀌면 무시된다. */
  blockedReason: z.string().optional(),
});

/** Web Push 구독 등록 본문. PushManager.subscribe 결과를 그대로 받는다. */
export const PushSubscriptionSchema = z.object({
  /** 푸시 서비스 엔드포인트 URL. */
  endpoint: z.string().url(),
  /** 만료 시각(epoch ms). 대부분 null. */
  expirationTime: z.number().nullable().optional(),
  /** 페이로드 암호화에 사용되는 키 페어. */
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

/** Web Push 구독 해제 본문. endpoint만으로 식별. */
export const PushUnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

/**
 * 에이전트/스킬 종류.
 */
export const EntryKindSchema = z.enum(["agent", "skill"]);

/**
 * 에이전트/스킬 저장 요청.
 */
export const EntrySaveSchema = z.object({
  /** 대상 프로젝트 id. */
  projectId: z.string().min(1),
  /** 종류. */
  kind: EntryKindSchema,
  /** 파일명 (확장자 제외). */
  name: z.string().min(1).regex(/^[^\\/]+$/, "이름에 / 또는 \\ 사용 불가"),
  /** 마크다운 본문. */
  body: z.string(),
});

/**
 * 에이전트/스킬 삭제 요청.
 */
export const EntryDeleteSchema = z.object({
  projectId: z.string().min(1),
  kind: EntryKindSchema,
  name: z.string().min(1),
});

/**
 * 에이전트 프론트매터 스키마.
 * raw YAML 입력 시 검증에 사용. 알려지지 않은 키는 passthrough로 허용 — 사용자가 새 메타 필드를
 * 실험하는 것을 막지 않는다. 핵심 필드의 *타입과 필수 여부*만 강제.
 */
export const AgentFrontmatterSchema = z
  .object({
    /** 파일명과 동일해야 한다. raw 모드에서 비교 검증. */
    name: z.string().min(1),
    /** 라우팅 판단에 쓰이는 한 줄 설명. */
    description: z.string().optional(),
    /** 모델 슬러그. 자유 입력 — 알려진 값(haiku/sonnet/opus/inherit) 외도 허용. */
    model: z.string().optional(),
    /** 사용 가능한 도구. 문자열 배열 또는 콤마 구분 단일 문자열 모두 수용. */
    tools: z.union([z.string(), z.array(z.string())]).optional(),
    /** UI 식별 색. */
    color: z.string().optional(),
  })
  .passthrough();

/**
 * 스킬 프론트매터 스키마. 에이전트와 동일한 정책(passthrough + 핵심 필드만 강제).
 */
export const SkillFrontmatterSchema = z
  .object({
    /** 파일명과 동일해야 한다. */
    name: z.string().min(1),
    /** 자동 호출 트리거 설명. */
    description: z.string().optional(),
    /** 추가 트리거 컨텍스트. */
    when_to_use: z.string().optional(),
    /** 인자 힌트 (오토컴플리트). */
    "argument-hint": z.string().optional(),
    /** 모델 슬러그. */
    model: z.string().optional(),
    /** 노력도. */
    effort: z.string().optional(),
    /** 권한 없이 사용할 수 있는 도구. */
    "allowed-tools": z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();

/**
 * 새 프로젝트 등록 요청.
 */
export const ProjectCreateSchema = z.object({
  /** 사용자에게 표시되는 이름. 1~60자. */
  name: z.string().min(1).max(60),
  /** .claude 디렉토리의 절대 경로. */
  claudeRoot: z.string().min(1),
  /** 세션 매칭에 사용할 작업 디렉토리 (선택). */
  workDir: z.string().optional(),
});

/**
 * 프로젝트 일부 필드 갱신.
 */
export const ProjectUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  /** 빈 문자열이면 workDir 해제. */
  workDir: z.string().optional(),
});
