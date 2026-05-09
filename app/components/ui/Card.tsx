import type { ReactNode, HTMLAttributes } from "react";
import { cn } from "./cn";

type DivProps = HTMLAttributes<HTMLDivElement>;

/** 모서리·테두리·그림자만 있는 표면 컨테이너. CardHeader/CardBody와 함께 조합. */
export function Card({ className, children, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Card 상단 헤더. 왼쪽 제목·오른쪽 액션 정렬용 (justify-between 기본). */
export function CardHeader({ className, children, ...rest }: DivProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Card 제목용 h2. 시각 무게는 design.md "카드 제목" 토큰. */
export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <h2
      className={cn(
        "text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100",
        className,
      )}
    >
      {children}
    </h2>
  );
}

/** Card 본문 영역. 리스트가 컨테이너 폭을 채우려면 className="p-0"으로 패딩 제거. */
export function CardBody({ className, children, ...rest }: DivProps) {
  return (
    <div className={cn("px-4 py-4", className)} {...rest}>
      {children}
    </div>
  );
}
