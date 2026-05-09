"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

/**
 * 가벼운 hover/focus tooltip. 브라우저 기본 `title`은 OS가 제어하는 ~500ms 지연이 있어
 * "왜 이 뱃지지?"처럼 즉시 알고 싶은 정보에는 부적합하므로, hover 시 거의 즉시 뜨는
 * 커스텀 변형을 둔다.
 *
 * - body로 portal — 부모의 `overflow-hidden`/`scroll`에 갇혀 잘리는 것을 방지
 * - 위치는 트리거 위(top) 중앙 정렬, fixed 좌표로 스크롤/리사이즈 시 재계산
 * - 마우스/포커스 둘 다 트리거
 * - 의존성 없음 (Radix 등 외부 라이브러리 미사용)
 */
export function Tooltip({
  content,
  children,
  className,
  style,
}: {
  /** 보여줄 짧은 안내. */
  content: ReactNode;
  /** 트리거가 되는 자식 요소. */
  children: ReactNode;
  /** 추가 클래스. wrapper span에 적용 — 위치/사이즈 등 호출자가 결정. */
  className?: string;
  /** 인라인 스타일. wrapper span에 적용. position·left·% 등 동적 값 전달용. */
  style?: React.CSSProperties;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    /** 트리거 위에 띄울지(top) 아래에 띄울지(bottom). 위 공간 부족 시 자동으로 bottom. */
    placement: "top" | "bottom";
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const node = triggerRef.current;
    if (!node) return;
    function update() {
      const r = node!.getBoundingClientRect();
      // 툴팁 자체 높이는 마운트된 후에 측정 가능. 첫 프레임은 추정치, 다음 프레임에서 보정.
      const tipH = tooltipRef.current?.offsetHeight ?? 60;
      const GAP = 6;
      // 트리거 위 빈 공간이 툴팁 높이보다 작으면 아래로 flip.
      const placement: "top" | "bottom" =
        r.top - GAP < tipH ? "bottom" : "top";
      const top = placement === "top" ? r.top - GAP : r.bottom + GAP;
      setPos({ top, left: r.left + r.width / 2, placement });
    }
    update();
    // 마운트 직후 실제 툴팁 높이로 1회 보정.
    const id = requestAnimationFrame(update);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  return (
    // 기본은 inline-flex만 — `relative`는 portal 계산에 불필요(getBoundingClientRect → fixed 좌표).
    // 호출자가 absolute 같은 positioning이 필요하면 className/style로 직접 부여한다.
    <span
      ref={triggerRef}
      className={cn("inline-flex", className)}
      style={style}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            // -translate-x-1/2: 가로 중앙 정렬. placement에 따라 위(-translate-y-full) / 아래(translate-y-0).
            className={cn(
              "pointer-events-none fixed z-[1000] max-w-xs -translate-x-1/2 whitespace-normal break-words rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] leading-snug text-zinc-700 shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200",
              pos.placement === "top" ? "-translate-y-full" : "translate-y-0",
            )}
            style={{ top: pos.top, left: pos.left }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}
