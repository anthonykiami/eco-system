"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Item = { href: string; label: string; icon: ReactNode };

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={path} />
  </svg>
);

export const MAIN_NAV: Item[] = [
  { href: "/", label: "Home", icon: icon("M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-4H4v4Zm10-13h6V4h-6v3Z") },
  { href: "/chat", label: "Chat", icon: icon("M4 5h16v11H8l-4 4V5Z") },
  { href: "/agents", label: "Agents", icon: icon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0") },
  { href: "/settings/schedules", label: "Tasks", icon: icon("M8 3v4m8-4v4M4 9h16M5 5h14v15H5V5Zm4 9 2 2 4-4") },
  { href: "/settings/integrations", label: "Integrations", icon: icon("M9 7V3m6 4V3M7 7h10v4a5 5 0 0 1-10 0V7Zm5 9v5") },
  { href: "/settings/telegram", label: "Telegram", icon: icon("m21 4-18 7 6 2m12-9-4 16-8-7m12-9-12 9") },
  { href: "/settings", label: "Settings", icon: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2.2-1.3L14.4 2h-4l-.4 2.4a7.4 7.4 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.4 7.4 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z") },
];

export const ADMIN_NAV: Item[] = [
  { href: "/admin", label: "System & users", icon: icon("M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z") },
  { href: "/admin/integrations", label: "App catalog", icon: icon("M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm12.5 0v7M13 16.5h7") },
];

/** The most specific item matching the path is the active one ("/settings" isn't active on "/settings/telegram"). */
function activeHref(pathname: string, items: Item[]): string | undefined {
  return items
    .filter((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function AppNav({ isAdmin, layout }: { isAdmin: boolean; layout: "sidebar" | "bar" }) {
  const pathname = usePathname();
  const active = activeHref(pathname, [...MAIN_NAV, ...(isAdmin ? ADMIN_NAV : [])]);

  const link = (item: Item) => {
    const current = item.href === active;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={current ? "page" : undefined}
        className={`flex items-center gap-3 whitespace-nowrap rounded-2xl px-3.5 py-2.5 text-sm transition ${
          current
            ? "glow bg-accent-soft font-medium text-foreground"
            : "text-muted hover:bg-surface-muted hover:text-foreground"
        }`}
      >
        {item.icon}
        {item.label}
      </Link>
    );
  };

  if (layout === "bar") {
    return (
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
        {MAIN_NAV.map(link)}
        {isAdmin && ADMIN_NAV.map(link)}
      </nav>
    );
  }

  return (
    <nav className="flex flex-1 flex-col gap-6" aria-label="Main">
      <div className="flex flex-col gap-0.5">{MAIN_NAV.map(link)}</div>
      {isAdmin && (
        <div className="flex flex-col gap-0.5">
          <p className="eyebrow flex items-center gap-2 px-3.5 pb-1.5">
            Admin
            <span className="rounded-full bg-warning-soft px-1.5 py-px text-[10px] tracking-normal normal-case text-warning">
              owner only
            </span>
          </p>
          {ADMIN_NAV.map(link)}
        </div>
      )}
    </nav>
  );
}
