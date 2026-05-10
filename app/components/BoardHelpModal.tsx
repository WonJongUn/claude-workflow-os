"use client";

import { Modal } from "./ui";

type BoardHelpModalProps = {
  /** 표시 여부. */
  open: boolean;
  /** 닫기 (백드롭/ESC/X). */
  onClose: () => void;
};

/** 칸반보드 자동화·트리거·UI 동작 설명 모달. 사용자 호출(i 버튼)로만 표시. */
export function BoardHelpModal({ open, onClose }: BoardHelpModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="칸반보드 동작 방식" size="lg">
      <div className="flex flex-col gap-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <Section title="상태 머신">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className="font-mono text-[11px]">OPEN → IN_PROGRESS → REVIEW → DONE</code>
              {" "}순서로 전이.
            </li>
            <li>
              REVIEW에서 <strong>반려</strong> 시 IN_PROGRESS로 되돌아간다.
            </li>
            <li>
              <code className="font-mono text-[11px]">CANCELLED</code>는 어느
              상태에서나 단방향 종료.
            </li>
          </ul>
        </Section>

        <Section title="자동 워커 spawn 트리거">
          <p className="text-xs text-zinc-500">
            워커는 다음 조건을 모두 만족할 때 headless Claude Code 세션을 spawn합니다.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>티켓 상태가 <code>OPEN</code>이거나, 사용자가 수동으로 바꾼 <code>IN_PROGRESS</code>인데 아직 <code>currentSessionId</code>가 없을 때.</li>
            <li><code>projectId</code>가 등록된 프로젝트 중 하나로 지정되어 있을 때 (미지정이면 워커 skip).</li>
            <li>현재 진행 중 티켓 수가 <code>maxConcurrentTickets</code> 한도 이내일 때.</li>
          </ul>
          <p className="text-xs text-zinc-500">
            트리거 시점:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>티켓이 <strong>새로 생성</strong>될 때 (<code>ticket.created</code> 이벤트).</li>
            <li>티켓이 <strong>수정</strong>되어 위 조건을 만족할 때 (<code>ticket.updated</code>).</li>
            <li>서버 부팅 시 OPEN 티켓 일괄 픽업.</li>
          </ul>
        </Section>

        <Section title="완료 기준 체크박스">
          <ul className="list-disc space-y-1 pl-5">
            <li><code>acceptance_criteria</code>는 <code>{`{text, checked}`}[]</code> 구조 — 사용자 또는 워커가 항목을 체크할 수 있다.</li>
            <li>모든 항목이 체크돼야 REVIEW → DONE 전이가 허용 (서버 강제, 불충족 시 409).</li>
            <li>레거시 string 배열은 자동으로 <code>{`{text, checked: false}`}</code>로 정규화.</li>
          </ul>
        </Section>

        <Section title="비정상 종료 회수">
          <ul className="list-disc space-y-1 pl-5">
            <li>워커 자식이 exit code 0이 아니거나 signal로 죽으면 자동으로 REVIEW로 회수된다.</li>
            <li>실패 사유가 <code>pendingQuestion</code>에 기록되어 카드에 답변 폼이 노출 + Web Push 발송.</li>
            <li>사용자가 답변을 보내면 그 내용으로 같은 세션을 resume → 자동 재시도.</li>
          </ul>
        </Section>

        <Section title="알림 (Web Push)">
          <ul className="list-disc space-y-1 pl-5">
            <li><code>IN_PROGRESS</code>에서 <code>blocked = true</code>로 전환될 때 발송.</li>
            <li><code>REVIEW</code> 상태로 진입할 때 발송.</li>
            <li>
              알림 클릭 시 <code className="font-mono text-[11px]">/board?ticket=&lt;id&gt;</code>
              로 라우팅 — 해당 티켓 편집 모달이 자동으로 열린다.
            </li>
          </ul>
        </Section>

        <Section title="카드 액션">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>카드 본문 클릭</strong> — 편집 다이얼로그 열기 (모든 필드 수정 가능).</li>
            <li><strong>시작</strong> (OPEN) — IN_PROGRESS로 전이. projectId 있으면 워커 자동 spawn.</li>
            <li><strong>복제</strong> (OPEN) — 동일 내용으로 새 티켓 생성. id가 새로 발급되어 워커가 다시 트리거된다.</li>
            <li><strong>검토 요청</strong> (IN_PROGRESS) — REVIEW로 전이.</li>
            <li><strong>차단 표시</strong> (IN_PROGRESS) — Web Push 발송 + blockedReason 기록.</li>
            <li><strong>승인</strong> (REVIEW) — 모든 acceptance_criteria가 체크된 경우 DONE 전이 (불충족 시 서버 409).</li>
            <li><strong>반려</strong> (REVIEW + textarea 입력) — 같은 세션을 resume하고 입력을 <code>[반려] ...</code>로 워커에 전달. 워커가 지적된 부분을 수정.</li>
            <li><strong>답변 보내기</strong> (REVIEW + pendingQuestion) — 같은 endpoint, 자유 텍스트로 전달.</li>
            <li><strong>휴지통 아이콘</strong> — 영구 삭제 (확인 다이얼로그 후).</li>
          </ul>
        </Section>

        <Section title="프로젝트 뷰">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>전체</strong> 탭 — 모든 프로젝트 티켓을 프로젝트별 섹션 + 디바이더로 나눠 표시.</li>
            <li>특정 프로젝트 탭 — 해당 프로젝트 티켓만 단일 4-컬럼 보드로 표시.</li>
            <li>활성 프로젝트는 URL <code className="font-mono text-[11px]">?project=&lt;id&gt;</code>가 단일 진실 원천 — 새로고침/공유에 안전.</li>
          </ul>
        </Section>

        <Section title="실시간 동기화">
          <ul className="list-disc space-y-1 pl-5">
            <li>티켓 변경은 SSE(<code>/api/sse</code>)로 모든 열린 보드에 즉시 반영.</li>
            <li>외부에서 JSON 파일을 직접 수정하면 SSE 이벤트가 발생하지 않으므로 새로고침 필요.</li>
          </ul>
        </Section>
      </div>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      {children}
    </section>
  );
}
