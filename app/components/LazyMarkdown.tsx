"use client";

import { memo, useEffect, useRef, useState } from "react";
import { SessionMarkdown } from "./SessionMarkdown";

/**
 * 화면(또는 그 근처)에 들어왔을 때만 SessionMarkdown을 마운트한다.
 *
 * 가상화 리스트는 viewport에 보이는 행만 렌더하지만, overscan으로 화면 밖에도 몇 개씩 그려진다.
 * 그 행들의 마크다운 파싱(react-markdown + rehype-highlight)은 첫 페인트에 큰 비용이 되므로,
 * IntersectionObserver로 진짜로 보이는 시점에만 마운트해 초기 비용을 더 줄인다.
 *
 * 같은 text는 재렌더 skip하도록 memo.
 */
export const LazyMarkdown = memo(function LazyMarkdown({
  text,
}: {
  text: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // SSR/구형 환경: 즉시 마운트.
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [visible]);

  // 마운트 전에는 텍스트 길이에 비례하는 회색 placeholder. 가상화의 measureElement가
  // 한 번 측정한 뒤에는 실제 마운트되어 다시 measure → 정확한 높이로 안정.
  if (!visible) {
    return (
      <div
        ref={ref}
        aria-hidden
        className="rounded bg-zinc-100/60 dark:bg-zinc-900/60"
        style={{ minHeight: estimateHeight(text) }}
      />
    );
  }
  return <SessionMarkdown text={text} />;
});

/** 텍스트 길이로 대략적인 placeholder 높이를 추정. 줄바꿈 + 글자 수 기준. */
function estimateHeight(text: string): number {
  const lines = text.split("\n").length;
  // 평균 한 줄 18px. 너무 긴 single-line도 wrap된다고 가정해 80자당 1줄 추가.
  const wrapped = Math.ceil(text.length / 80);
  return Math.min(400, Math.max(20, (lines + wrapped) * 18));
}
