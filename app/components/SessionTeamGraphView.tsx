"use client";

import { useMemo } from "react";
import {
  type ParsedEvent,
  normalizeContent,
} from "./session-log-shared";
import { Badge, EmptyState, Tooltip, cn } from "./ui";

/**
 * 팀 lead(=TeamCreate) 노드와 팀원(=Agent input.team_name 매칭) 노드를
 * 한 팀당 하나의 SVG 그래프로 그린다.
 *
 * 매칭 규칙:
 * - TeamCreate.input.team_name 으로 팀을 정의.
 * - Agent.input.team_name 이 같은 값이면 팀원으로 묶는다.
 * - team_name 없는 Agent는 일반 서브에이전트라 무시.
 * - TeamCreate 없이 Agent만 team_name을 갖고 있는 경우는 "고아 팀"으로 별도 렌더 (메타 없음).
 */
export function SessionTeamGraphView({
  events,
}: {
  events: ParsedEvent[];
}) {
  const teams = useMemo(() => buildTeams(events), [events]);

  if (teams.length === 0) {
    return <EmptyState>이 세션에서 만들어진 팀이 없습니다.</EmptyState>;
  }
  return (
    <div className="flex flex-col gap-6">
      {teams.map((t) => (
        <TeamGraph key={t.key} team={t} />
      ))}
    </div>
  );
}

/**
 * 한 팀의 그래프.
 * - 상단: lead 노드(가운데 정렬, 폭은 컨텐츠 길이에 맞춤).
 * - 중간: 디귿 모양 커넥터 영역(고정 높이, CSS div 라인).
 * - 하단: 팀원 노드들(grid로 N등분, 박스 높이는 컨텐츠 따라 가변).
 *
 * 박스 높이 고정값을 두지 않아 description이 길어도 잘리지 않는다.
 */
function TeamGraph({ team }: { team: Team }) {
  const memberCount = team.members.length;
  return (
    <div className="overflow-x-auto">
      <div className="mx-auto flex w-fit max-w-full flex-col items-center">
        <div className="w-[16rem]">
          <LeadNode team={team} />
        </div>
        {memberCount > 0 && <Connector count={memberCount} />}
        {memberCount > 0 && (
          <div
            className="grid w-full gap-4"
            style={{
              gridTemplateColumns: `repeat(${memberCount}, minmax(14rem, 16rem))`,
            }}
          >
            {team.members.map((m) => (
              <MemberNode key={m.id} member={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * lead → 팀원들로 내려가는 디귿 커넥터.
 * - 1명: 단일 수직선.
 * - 2명+: 가운데 수직선 + 가로 버스 + 각 팀원 수직선.
 *
 * 가로 버스는 grid 컬럼의 *중심점*을 잇기 위해 양 끝 50%씩 inset.
 * (첫·마지막 멤버 박스 가운데에서 시작/끝)
 */
function Connector({ count }: { count: number }) {
  const lineCls = "bg-zinc-300 dark:bg-zinc-700";
  return (
    <div
      className="relative w-full"
      style={{ height: 28 }}
      aria-hidden
    >
      {/* lead 바닥 → 가로 버스 */}
      <div
        className={cn("absolute left-1/2 top-0 w-px -translate-x-1/2", lineCls)}
        style={{ height: 14 }}
      />
      {count > 1 && (
        // 가로 버스: 첫/마지막 멤버 컬럼 중심까지 (각 컬럼은 1/N 폭, 중심은 ±50%).
        <div
          className={cn("absolute h-px", lineCls)}
          style={{
            top: 14,
            left: `${50 / count}%`,
            right: `${50 / count}%`,
          }}
        />
      )}
      {/* 가로 버스 → 각 멤버 박스 상단 */}
      {Array.from({ length: count }).map((_, i) => {
        const centerPct = ((i + 0.5) / count) * 100;
        return (
          <div
            key={i}
            className={cn("absolute w-px -translate-x-1/2", lineCls)}
            style={{ left: `${centerPct}%`, top: 14, height: 14 }}
          />
        );
      })}
    </div>
  );
}

/** 팀 lead = TeamCreate 호출 노드. 팀 이름·agent_type·description 표시. */
function LeadNode({ team }: { team: Team }) {
  const ts = team.ts > 0 ? new Date(team.ts).toLocaleString() : null;
  return (
    <Tooltip
      content={
        team.description ?? (team.synthetic ? "TeamCreate 호출 없음 (Agent input.team_name으로만 추론)" : "")
      }
    >
      <div
        className={cn(
          "flex flex-col gap-1 rounded-lg border bg-white p-2.5 shadow-sm dark:bg-zinc-950",
          team.synthetic
            ? "border-dashed border-zinc-300 dark:border-zinc-700"
            : "border-violet-300 ring-1 ring-violet-200/60 dark:border-violet-700 dark:ring-violet-900/40",
        )}
      >
        <div className="flex items-center gap-1.5">
          <Badge variant="subagent">팀</Badge>
          <span className="truncate font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {team.name}
          </span>
        </div>
        {team.agentType && (
          <div className="text-[10px] text-zinc-500">
            lead: <span className="font-mono">{team.agentType}</span>
          </div>
        )}
        {team.description && (
          <p className="line-clamp-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            {team.description}
          </p>
        )}
        {ts && (
          <div className="mt-auto font-mono text-[10px] tabular-nums text-zinc-400">
            {ts}
          </div>
        )}
      </div>
    </Tooltip>
  );
}

/** 팀원 = Agent 호출 노드. name·subagent_type·description 표시. */
function MemberNode({ member }: { member: TeamMember }) {
  return (
    <Tooltip content={member.description ?? ""}>
      <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-1.5">
          <Badge variant="default">멤버</Badge>
          <span className="truncate font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {member.name ?? "(이름 없음)"}
          </span>
        </div>
        {member.subagentType && (
          <div className="text-[10px] text-zinc-500">
            type: <span className="font-mono">{member.subagentType}</span>
          </div>
        )}
        {member.description && (
          <p className="line-clamp-2 text-[11px] leading-snug text-zinc-600 dark:text-zinc-400">
            {member.description}
          </p>
        )}
      </div>
    </Tooltip>
  );
}

type Team = {
  /** React 키 — team_name이 비어 있으면 합성. */
  key: string;
  /** team_name (TeamCreate.input 또는 Agent.input). */
  name: string;
  /** TeamCreate.input.agent_type — lead의 타입. synthetic이면 null. */
  agentType: string | null;
  /** TeamCreate.input.description. synthetic이면 null. */
  description: string | null;
  /** TeamCreate 호출 시각. synthetic이면 0. */
  ts: number;
  /** TeamCreate가 없고 Agent의 team_name으로만 추론한 팀이면 true (점선 테두리). */
  synthetic: boolean;
  members: TeamMember[];
};

type TeamMember = {
  /** 메시지 uuid — React 키. */
  id: string;
  /** Agent.input.name — 팀 안의 별명. */
  name: string | null;
  /** Agent.input.subagent_type — 베이스 에이전트 타입. */
  subagentType: string | null;
  /** Agent.input.description — 한 줄 임무. */
  description: string | null;
};

function toolUseInput(ev: ParsedEvent): Record<string, unknown> | null {
  const block = normalizeContent(ev.raw.message?.content).find(
    (b) => b.type === "tool_use",
  );
  if (!block || block.type !== "tool_use") return null;
  const input = (block as { input?: unknown }).input;
  if (!input || typeof input !== "object") return null;
  return input as Record<string, unknown>;
}

/**
 * events에서 팀과 팀원을 묶는다.
 * 팀 정의 우선순위: TeamCreate가 있으면 메타 채움 → 없으면 Agent의 team_name으로 합성.
 */
function buildTeams(events: ParsedEvent[]): Team[] {
  const byName = new Map<string, Team>();

  // 1) TeamCreate로 팀 정의.
  for (const ev of events) {
    if (ev.toolName !== "TeamCreate") continue;
    const input = toolUseInput(ev);
    const teamName =
      typeof input?.team_name === "string" && input.team_name.length > 0
        ? input.team_name
        : null;
    if (!teamName) continue;
    if (byName.has(teamName)) continue;
    byName.set(teamName, {
      key: teamName,
      name: teamName,
      agentType: typeof input?.agent_type === "string" ? input.agent_type : null,
      description:
        typeof input?.description === "string" ? input.description : null,
      ts: ev.ts ?? 0,
      synthetic: false,
      members: [],
    });
  }

  // 2) Agent로 팀원 묶기. TeamCreate가 없는 team_name이면 synthetic 팀 합성.
  for (const ev of events) {
    if (ev.toolName !== "Agent") continue;
    const input = toolUseInput(ev);
    const teamName =
      typeof input?.team_name === "string" && input.team_name.length > 0
        ? input.team_name
        : null;
    if (!teamName) continue;
    let team = byName.get(teamName);
    if (!team) {
      team = {
        key: `__synth__:${teamName}`,
        name: teamName,
        agentType: null,
        description: null,
        ts: 0,
        synthetic: true,
        members: [],
      };
      byName.set(teamName, team);
    }
    team.members.push({
      id: ev.raw.uuid ?? `${ev.ts ?? 0}-${team.members.length}`,
      name: typeof input?.name === "string" ? input.name : null,
      subagentType:
        typeof input?.subagent_type === "string" ? input.subagent_type : null,
      description:
        typeof input?.description === "string" ? input.description : null,
    });
  }

  // TeamCreate가 시간순 가장 빠른 게 위로 — synthetic은 끝에.
  return [...byName.values()].sort((a, b) => {
    if (a.synthetic !== b.synthetic) return a.synthetic ? 1 : -1;
    return a.ts - b.ts;
  });
}
