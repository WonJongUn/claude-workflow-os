"use client";

import { useMemo } from "react";
import { cn, inputBaseClass } from "./ui";
import { useProjectContext } from "./use-projects";

type AgentSelectProps = {
  /** 현재 선택된 에이전트 슬러그. 빈 문자열 = 미지정. */
  value: string;
  /** 변경 콜백. */
  onChange: (next: string) => void;
  /** 선택지를 가져올 활성 프로젝트 id. */
  projectId: string;
};

/**
 * 글로벌(사용자) + 활성 프로젝트의 에이전트를 optgroup으로 묶어 보여준다.
 * 활성이 ALL이면 글로벌만 표시한다.
 */
export function AgentSelect({ value, onChange, projectId }: AgentSelectProps) {
  const { context: globalCtx } = useProjectContext("ALL");
  const { context: projectCtx } = useProjectContext(projectId);

  const isAll = projectId === "ALL";
  const globalAgents = useMemo(
    () => globalCtx?.agents.map((a) => a.name) ?? [],
    [globalCtx],
  );
  const projectAgents = useMemo(
    () => (isAll ? [] : (projectCtx?.agents.map((a) => a.name) ?? [])),
    [projectCtx, isAll],
  );

  return (
    <select
      className={cn(inputBaseClass)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">(미지정)</option>
      {projectAgents.length > 0 && (
        <optgroup label="프로젝트">
          {projectAgents.map((name) => (
            <option key={`p:${name}`} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      )}
      {globalAgents.length > 0 && (
        <optgroup label="글로벌">
          {globalAgents.map((name) => (
            <option key={`g:${name}`} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
