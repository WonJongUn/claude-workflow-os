"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import "highlight.js/styles/github.css";

/**
 * 플러그인 인스턴스를 모듈 스코프에 두어 매 렌더마다 새 배열을 만들지 않는다.
 * react-markdown은 plugin prop의 참조 변경을 감지해 다시 처리하므로 안정 참조가 중요.
 */
const REMARK_PLUGINS = [remarkGfm];
/** detect:true → 언어 펜스가 없는 코드 블록도 highlight.js의 자동 감지로 색을 입힌다. */
const REHYPE_PLUGINS = [[rehypeHighlight, { detect: true }]] as const;

/**
 * 세션 화면 안에서 마크다운 텍스트를 렌더한다.
 * - GFM(테이블·체크박스·취소선) 지원
 * - rehype-highlight로 코드 블록 언어별 하이라이트
 *
 * 같은 text는 재렌더 skip하도록 memo. 부모(타임라인 행)가 폴링으로 자주 재렌더되어도
 * 마크다운 파싱 비용을 한 번만 지불한다.
 */
export const SessionMarkdown = memo(function SessionMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="prose-conversation text-[12px] leading-relaxed text-zinc-800 dark:text-zinc-200">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS as never}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
