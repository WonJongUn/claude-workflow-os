"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType } from "react";
import {
  Activity,
  KanbanSquare,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { cn } from "./ui";

type NavItem = {
  /** 라우트 경로. */
  href: string;
  /** 메뉴 라벨. */
  label: string;
  /** 라벨 옆/대체로 표시할 아이콘 컴포넌트. */
  Icon: ComponentType<{ className?: string }>;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "대시보드", Icon: LayoutDashboard },
  { href: "/board", label: "칸반보드", Icon: KanbanSquare },
  { href: "/monitoring", label: "모니터링", Icon: Activity },
  { href: "/settings", label: "설정", Icon: Settings },
];

const STORAGE_KEY = "sidebar.collapsed";

/**
 * 좌측 고정 사이드바. 접기/펼치기 토글을 지원하고 상태를 localStorage에 보존.
 */
export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    // SSR/CSR 하이드레이션 미스매치 방지를 위해 마운트 후 1회 동기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(saved === "1");
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const isCollapsed = collapsed === true;

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col gap-1 border-r border-zinc-200 bg-zinc-50 p-3 transition-[width] duration-150 ease-out dark:border-zinc-800 dark:bg-zinc-950",
        isCollapsed ? "w-16 items-center" : "w-56",
      )}
    >
      <div
        className={cn(
          "mb-3 flex w-full items-center gap-2",
          isCollapsed ? "justify-center" : "justify-between",
        )}
      >
        {!isCollapsed && (
          <div className="min-w-0 px-1">
            <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Workflow OS
            </div>
            <div className="truncate text-[11px] text-zinc-500">
              로컬 컨트롤 플레인
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={isCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          title={isCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm transition-colors hover:border-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>
      <nav
        className={cn(
          "flex flex-col gap-0.5",
          isCollapsed ? "w-auto" : "w-full",
        )}
      >
        {NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            collapsed={isCollapsed}
          />
        ))}
      </nav>
    </aside>
  );
}

type NavLinkProps = {
  /** 메뉴 항목. */
  item: NavItem;
  /** 현재 경로 여부. */
  active: boolean;
  /** 사이드바 축소 여부. true면 라벨 숨김. */
  collapsed: boolean;
};

function NavLink({ item, active, collapsed }: NavLinkProps) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      className={cn(
        "group relative flex items-center rounded-md text-sm transition-colors",
        collapsed ? "h-9 w-9 justify-center" : "gap-2 px-3 py-2",
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span>{item.label}</span>}
      {collapsed && <SidebarTooltip label={item.label} />}
    </Link>
  );
}

/**
 * 접힌 사이드바 항목에서 hover 시 우측에 라벨을 띄우는 작은 툴팁.
 * group-hover로 표시되며, 본문이 좁아도 라벨은 nowrap.
 */
function SidebarTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
    >
      {label}
    </span>
  );
}

/**
 * 현재 경로가 메뉴 항목 활성 상태인지. prefix 매칭이라 하위 경로도 활성.
 */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
