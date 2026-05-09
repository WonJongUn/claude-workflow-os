"use client";

import { Badge, Tooltip } from "./ui";
import { SIDECHAIN_TOOLTIP } from "./session-log-shared";

/**
 * 서브에이전트 표시 뱃지.
 * Timeline / 대화 / 편집 파일 등 모든 뷰에서 동일한 외형 + 툴팁을 보장하기 위한 단일 진입점.
 *
 * 의미 색은 violet — 다른 뷰의 사이드체인 좌측 가이드 라인과 톤 통일.
 * (이전 warning/앰버는 tool_result(`결과`) 뱃지와 색이 같아 시각 충돌 발생.)
 *
 * 줄바꿈 방지를 위해 nowrap. 좁은 컬럼에서도 한 줄로 유지된다.
 */
export function SidechainBadge() {
  return (
    <Tooltip content={SIDECHAIN_TOOLTIP}>
      <Badge variant="subagent" className="whitespace-nowrap">
        서브에이전트
      </Badge>
    </Tooltip>
  );
}
