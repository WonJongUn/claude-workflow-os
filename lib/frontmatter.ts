/**
 * 마크다운 파일의 YAML 프론트매터 파서/시리얼라이저.
 * 파싱·직렬화는 `yaml`(eemeli) 라이브러리에 위임 — 블록 스칼라, 다중행 배열,
 * 이스케이프 등 풀 YAML 1.2를 정확히 처리한다. 이 모듈은 fence 처리만 책임진다.
 */

import { parse as yamlParse, stringify as yamlStringify } from "yaml";

/**
 * 프론트매터 값. 기존 단순 폼(string/string[])뿐 아니라 YAML이 자연스럽게 반환할 수 있는
 * number/boolean도 그대로 허용한다 — 호출자(zod 스키마)가 최종 타입 검증을 한다.
 */
export type FrontmatterValue = string | string[] | number | boolean;

export type ParsedDocument = {
  /** 프론트매터 키-값. 없으면 빈 객체. */
  frontmatter: Record<string, FrontmatterValue>;
  /** 본문 (프론트매터 제외). */
  body: string;
};

/** `---` 펜스 패턴. 선행 공백/개행은 호출 측에서 제거 후 매칭한다. */
const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * 문자열에서 프론트매터를 추출한다. 펜스가 없으면 frontmatter는 빈 객체.
 *
 * - 선행 공백/개행은 fence 매칭 전에 제거한다 (raw 붙여넣기 보호).
 * - 매칭 실패 시 *원본*을 body로 반환.
 * - YAML 파싱 실패 시 frontmatter는 빈 객체로 두고 본문만 돌려준다 — 사용자가 작성 중인 깨진
 *   YAML이 모드 전환을 막지 않게 한다 (검증은 호출 측에서 별도).
 */
export function parseFrontmatter(input: string): ParsedDocument {
  const lead = input.match(/^\s*/)?.[0] ?? "";
  const trimmed = input.slice(lead.length);
  const match = trimmed.match(FENCE);
  if (!match) return { frontmatter: {}, body: input };
  const yamlBlock = match[1];
  const body = trimmed.slice(match[0].length);
  let parsed: unknown;
  try {
    parsed = yamlParse(yamlBlock);
  } catch {
    return { frontmatter: {}, body };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { frontmatter: {}, body };
  }
  const frontmatter: Record<string, FrontmatterValue> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const coerced = coerce(v);
    if (coerced !== undefined) frontmatter[k] = coerced;
  }
  return { frontmatter, body };
}

/**
 * 프론트매터 + 본문을 단일 문자열로 직렬화. 빈 값은 생략한다.
 * YAML 직렬화도 라이브러리에 위임 — 줄바꿈 있는 문자열은 자동으로 `|` 블록 스칼라로 emit.
 */
export function stringifyFrontmatter(doc: ParsedDocument): string {
  const filtered: Record<string, FrontmatterValue> = {};
  for (const [k, v] of Object.entries(doc.frontmatter)) {
    if (isEmpty(v)) continue;
    filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) return doc.body;
  // lineWidth=0: 자동 줄바꿈 비활성화. 짧은 한 줄 문자열이 갑자기 wrap 되어 diff가 흔들리는 것 방지.
  const yaml = yamlStringify(filtered, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${doc.body.replace(/^\n+/, "")}`;
}

/** YAML이 돌려준 값을 FrontmatterValue 셋 중 하나로 좁힌다. 그 외 형태(객체, null 등)는 drop. */
function coerce(v: unknown): FrontmatterValue | undefined {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  if (Array.isArray(v)) {
    // 배열은 각 항목을 문자열화해 string[]으로 통일.
    return v.map((x) => (typeof x === "string" ? x : String(x)));
  }
  return undefined;
}

function isEmpty(value: FrontmatterValue): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}
