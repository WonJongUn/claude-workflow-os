"use client";

import { memo, useMemo } from "react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";

/**
 * 코드/플레인 텍스트 전용 렌더러. tool_use(JSON 입력) · tool_result(텍스트 결과)처럼
 * 마크다운 문법이 들어있지 않은 본문을 SessionMarkdown(react-markdown + remark-gfm + rehype 파이프라인)에
 * 보내면 매 렌더마다 markdown AST 파싱이 일어나 낭비가 크다.
 *
 * 대신 highlight.js 만 직접 호출해 `<pre><code>` 한 번만 그린다.
 * memo로 같은 (text, language) 쌍은 재렌더 skip.
 *
 * - language: "json" | "text" | undefined.
 *   - 명시되면 highlight(text, { language })로 단일 언어 하이라이트.
 *   - 생략하면 자동 감지 (highlightAuto).
 *   - "text"는 하이라이트 없이 그대로 출력 (이스케이프만).
 */
export const SessionCodeBlock = memo(function SessionCodeBlock({
  text,
  language,
}: {
  text: string;
  language?: "json" | "text";
}) {
  const html = useMemo(() => {
    if (language === "text") return escapeHtml(text);
    try {
      if (language) {
        return hljs.highlight(text, { language, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(text).value;
    } catch {
      return escapeHtml(text);
    }
  }, [text, language]);

  return (
    <pre className="scroll-thin max-h-[40vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
      <code
        className={`hljs font-mono text-zinc-800 dark:text-zinc-200${
          language ? ` language-${language}` : ""
        }`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </pre>
  );
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
