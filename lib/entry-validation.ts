import { parse as yamlParse } from "yaml";
import { parseFrontmatter } from "./frontmatter";
import {
  AgentFrontmatterSchema,
  EntryKindSchema,
  SkillFrontmatterSchema,
} from "./schemas";
import type { z } from "zod";

export type EntryKind = z.infer<typeof EntryKindSchema>;

/** 검증 결과: ok이면 frontmatter/본문, 아니면 사람 읽기용 issues. */
export type ValidationResult =
  | {
      ok: true;
      /** parseFrontmatter가 뽑아낸 raw 프론트매터. */
      frontmatter: Record<string, unknown>;
      /** 프론트매터를 제외한 본문. */
      body: string;
    }
  | {
      ok: false;
      /** 사용자에게 보여줄 한 줄(또는 여러 줄) 에러 메시지들. */
      issues: string[];
    };

/**
 * AgentForm/SkillForm의 raw YAML 모드에서 사용자가 붙여넣은 markdown(프론트매터 + 본문)을
 * 검증한다. 파일에 저장하기 전 클라이언트 측에서 1차 검증해 즉각 피드백을 준다.
 *
 * 규칙:
 * - 프론트매터(`---` 펜스)가 반드시 존재해야 한다.
 * - 종류별 zod 스키마(AgentFrontmatterSchema/SkillFrontmatterSchema)를 통과해야 한다.
 * - frontmatter.name이 입력으로 받은 expectedName과 일치해야 한다 — 파일명과 어긋나면 거부.
 *   (편집 모드에서는 expectedName을 인자로 넘기고, 신규 모드에서는 사용자가 적어둔 이름을 넘긴다.)
 */
export function validateRawEntry(
  kind: EntryKind,
  source: string,
  expectedName?: string,
): ValidationResult {
  if (!source.trim()) {
    return { ok: false, issues: ["내용이 비어있습니다."] };
  }
  if (!source.trimStart().startsWith("---")) {
    return {
      ok: false,
      issues: [
        "프론트매터(--- 펜스)가 필요합니다. 예:\n---\nname: my-agent\n---",
      ],
    };
  }
  const { frontmatter, body } = parseFrontmatter(source);
  if (Object.keys(frontmatter).length === 0) {
    return {
      ok: false,
      issues: ["프론트매터를 파싱할 수 없습니다. --- 펜스 안에 key: value 쌍을 적어주세요."],
    };
  }
  const schema = kind === "agent" ? AgentFrontmatterSchema : SkillFrontmatterSchema;
  const parsed = schema.safeParse(frontmatter);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => {
        const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
        return `${path}${i.message}`;
      }),
    };
  }
  if (
    expectedName &&
    typeof parsed.data.name === "string" &&
    parsed.data.name !== expectedName
  ) {
    return {
      ok: false,
      issues: [
        `파일명(${expectedName})과 frontmatter.name(${parsed.data.name})이 다릅니다.`,
      ],
    };
  }
  return { ok: true, frontmatter: parsed.data, body };
}

/**
 * 모든 비공백 라인이 동일한 양의 선행 공백을 가지면 그만큼 빼낸다 (paste artifact 자동 정리).
 * 공통 들여쓰기가 0이면 원본 그대로 반환.
 */
export function dedentCommon(source: string): string {
  if (!source) return source;
  const lines = source.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return source;
  const minLead = Math.min(
    ...nonEmpty.map((l) => l.match(/^[ \t]*/)?.[0].length ?? 0),
  );
  if (minLead === 0) return source;
  return lines
    .map((l) => (l.trim().length === 0 ? l : l.slice(minLead)))
    .join("\n");
}

/** raw markdown의 형식 경고. 저장을 막진 않지만 사용자에게 알려준다. */
export type RawLintHint = {
  /** 사람 읽기용 메시지. */
  message: string;
  /** 영향받는 라인 번호 (1-based). 여러 줄이면 첫 줄. */
  line?: number;
};

/**
 * raw 마크다운 입력을 가볍게 점검해 paste artifact 같은 흔한 실수를 알려준다.
 * 검증과 달리 저장을 막지 않는다 — *경고*만 반환.
 *
 * 검사 항목:
 * - 모든 비공백 라인이 동일한 양의 선행 공백 (paste 시 들여쓰기로 끌려온 경우)
 * - YAML 프론트매터 영역에 탭 사용 (YAML 사양 위반)
 * - 프론트매터 닫는 펜스 누락
 * - 트레일링 공백이 있는 라인
 * - 혼합 줄바꿈 (CRLF + LF)
 */
export function lintRawEntry(source: string): RawLintHint[] {
  if (!source.trim()) return [];
  const hints: RawLintHint[] = [];
  const lines = source.split(/\r?\n/);

  // (선행 공백 균등 들여쓰기는 dedentCommon이 자동 정리하므로 lint에서는 다루지 않는다.)

  // 2) 프론트매터 펜스 검사 — 닫는 --- 없으면 경고.
  const opening = source.match(/^\s*---\r?\n/);
  if (opening) {
    const after = source.slice(opening[0].length);
    if (!/\r?\n---/.test(after)) {
      hints.push({
        message: "프론트매터 닫는 --- 펜스를 찾지 못했습니다.",
      });
    } else {
      const closeIdx = after.search(/\r?\n---/);
      const yamlBlock = after.slice(0, closeIdx);
      // 3) 프론트매터 영역에 탭이 있는지 — YAML은 indent에 탭 금지.
      const tabLineRel = yamlBlock
        .split(/\r?\n/)
        .findIndex((l) => /^\s*\t/.test(l) || /\t/.test(l));
      if (tabLineRel >= 0) {
        const startOfYaml = source.slice(0, opening[0].length).split(/\r?\n/).length;
        hints.push({
          message: "프론트매터에 탭 문자가 있습니다. YAML은 들여쓰기에 공백만 허용합니다.",
          line: startOfYaml + tabLineRel,
        });
      }
      // 4) yaml 파서가 실제로 문제를 잡으면 메시지를 그대로 보여준다 — "왜 폼이 비는지" 가장 직접적인 단서.
      try {
        yamlParse(yamlBlock);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // yaml 라이브러리 메시지는 한 줄 단위로 잘라 첫 줄만 보여준다.
        hints.push({
          message: `YAML 파싱 오류: ${msg.split("\n")[0]} (긴 description 등은 \`|\` 블록 스칼라로)`,
        });
      }
    }
  } else if (source.trimStart().length > 0) {
    hints.push({
      message: "프론트매터(--- 펜스)가 없습니다.",
    });
  }

  // 4) 트레일링 공백.
  const trailingLine = lines.findIndex((l) => /[ \t]+$/.test(l) && l.trim().length > 0);
  if (trailingLine >= 0) {
    hints.push({
      message: "줄 끝에 공백이 있습니다.",
      line: trailingLine + 1,
    });
  }

  // 5) 혼합 줄바꿈.
  const hasCrlf = /\r\n/.test(source);
  const hasLfOnly = /(?<!\r)\n/.test(source);
  if (hasCrlf && hasLfOnly) {
    hints.push({ message: "줄바꿈이 LF/CRLF 혼합입니다." });
  }

  return hints;
}
