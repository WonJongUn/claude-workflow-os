import type { ReactNode, HTMLAttributes } from "react";
import { cn } from "./cn";

type DivProps = HTMLAttributes<HTMLDivElement>;

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

export function CardBody({ className, children, ...rest }: DivProps) {
  return (
    <div className={cn("px-4 py-4", className)} {...rest}>
      {children}
    </div>
  );
}
