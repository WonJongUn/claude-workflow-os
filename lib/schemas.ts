import { z } from "zod";
import type { AcceptanceCriterion, TicketDraft, TicketStatus } from "./types";

/**
 * 완료 기준 한 항목. HTTP 경계에서 두 가지 형태를 모두 받는다:
 *   - 신규 객체 형태 `{text, checked}`
 *   - 레거시 문자열 (`checked: false`로 정규화)
 * 입력은 너그럽게(union), 출력은 항상 객체로 통일.
 */
export const AcceptanceCriterionInputSchema = z.union([
  z.object({
    text: z.string().min(1),
    checked: z.boolean().default(false),
  }),
  z
    .string()
    .transform((text) => ({ text, checked: false }) satisfies AcceptanceCriterion),
]);

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
  acceptance_criteria: z.array(AcceptanceCriterionInputSchema).default([]),
  /** 외부 자료/링크. */
  references: z.array(z.string()).optional(),
  /** 우선순위. 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPrioritySchema,
  /** 초기 상태. 미지정 시 OPEN. */
  status: TicketStatusSchema.optional(),
  /** 생성 시점에 차단 상태로 시작할지. */
  blocked: z.boolean().optional(),
  /** 자동 워커가 실행할 프로젝트 id. 필수 — 없으면 워커가 픽업 못 함. */
  projectId: z.string().min(1, "프로젝트를 선택하세요"),
  /** 자동 스케줄링 활성 여부. 미지정 시 true. false면 워커가 픽업하지 않는다. */
  autoSchedule: z.boolean().optional(),
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

/**
 * PATCH `/api/tickets/[id]`의 일반 필드 갱신 본문.
 * 모든 필드 optional — 변경하려는 필드만 보낸다. TicketDraft의 부분 갱신 형태.
 */
export const TicketUpdateSchema = z.object({
  /** 사용자에게 표시되는 한 줄 요약. 1자 이상. */
  title: z.string().min(1).optional(),
  /** 담당 에이전트 슬러그. */
  agent: z.string().optional(),
  /** 무엇을, 왜 해야 하는지. 1자 이상. */
  goal: z.string().min(1).optional(),
  /** 배경 설명. 의사결정 맥락이나 관련 이슈 링크. */
  background: z.string().optional(),
  /** 충족해야 할 기능적 요건 목록. 전체 교체 (부분 추가 아님). */
  requirements: z.array(z.string()).optional(),
  /** 완료 판정 기준 목록. 워커 스킬이 진행 중 checked를 토글. */
  acceptance_criteria: z.array(AcceptanceCriterionInputSchema).optional(),
  /** 외부 자료/링크. 전체 교체. */
  references: z.array(z.string()).optional(),
  /** 보드 정렬과 알림 임계값에 사용. */
  priority: TicketPrioritySchema.optional(),
  /** 차단 여부. true로 바꾸려면 보통 reason도 같이 보낸다. */
  blocked: z.boolean().optional(),
  /** blocked=true일 때 사유. blocked가 false로 바뀌면 무시된다. */
  blockedReason: z.string().optional(),
  /** 자동 워커가 실행할 프로젝트 id. */
  projectId: z.string().optional(),
  /** 자동 스케줄링 활성 여부. false → 워커 픽업 보류. true로 바뀌면 다음 tick에 픽업. */
  autoSchedule: z.boolean().optional(),
  /** 워커 자동화 메타. 워커 스킬이 PATCH로 채운다. null이면 명시적 클리어. */
  currentSessionId: z.string().nullable().optional(),
  /** REVIEW 단계에서 사용자에게 보여줄 질문. null로 보내면 클리어. */
  pendingQuestion: z.string().nullable().optional(),
  /** REVIEW가 "사용자 승인 대기" 모드임을 표시. true일 때만 DONE 승인 버튼 노출. */
  pendingApproval: z.boolean().optional(),
  /** 워커 로그 파일 경로. null로 보내면 클리어. */
  workerLog: z.string().nullable().optional(),
});

/** POST `/api/tickets/[id]/answer`의 본문. 사용자가 REVIEW 카드에 입력한 답변. */
export const AnswerBodySchema = z.object({
  /** 사용자 답변. 1자 이상. */
  answer: z.string().min(1),
});

/** Web Push 구독 등록 본문. PushManager.subscribe 결과를 그대로 받는다. */
export const PushSubscriptionSchema = z.object({
  /** 푸시 서비스 엔드포인트 URL. */
  endpoint: z.string().url(),
  /** 만료 시각(epoch ms). 대부분 null. */
  expirationTime: z.number().nullable().optional(),
  /** 페이로드 암호화에 사용되는 키 페어. */
  keys: z.object({
    /** ECDH 공개 키 (base64url). */
    p256dh: z.string(),
    /** 인증 시크릿 (base64url). */
    auth: z.string(),
  }),
});

/** Web Push 구독 해제 본문. endpoint만으로 식별. */
export const PushUnsubscribeSchema = z.object({
  /** 해제할 구독의 푸시 서비스 엔드포인트 URL. */
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
  /** 대상 프로젝트 id. */
  projectId: z.string().min(1),
  /** 종류 (agent | skill). */
  kind: EntryKindSchema,
  /** 파일명 (확장자 제외). */
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
  /** 사용자에게 표시되는 이름. 1~60자. */
  name: z.string().min(1).max(60).optional(),
  /** 빈 문자열이면 workDir 해제. */
  workDir: z.string().optional(),
});
