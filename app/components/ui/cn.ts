/**
 * 조건부 className 합성 유틸. falsy(null/undefined/false)는 제거하고 공백 1칸으로 join.
 * clsx/classnames 외부 의존을 피하기 위한 자체 구현. 객체/배열 형식은 지원하지 않음 — 단순히 가변 인자만.
 */
export function cn(
  ...classes: (string | false | null | undefined)[]
): string {
  return classes.filter(Boolean).join(" ");
}
