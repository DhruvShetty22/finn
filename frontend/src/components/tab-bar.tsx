"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import type { Brief } from "@/lib/types";

const TABS = [
  { href: "/", label: "Brief", icon: BriefIcon, match: (p: string) => p === "/" },
  { href: "/holdings", label: "Holdings", icon: HoldingsIcon, match: (p: string) => p.startsWith("/holdings") || p.startsWith("/thesis") },
  { href: "/ask", label: "Ask", icon: AskIcon, match: (p: string) => p.startsWith("/ask") || p.startsWith("/research") },
  { href: "/alerts", label: "Alerts", icon: AlertsIcon, match: (p: string) => p.startsWith("/alerts") },
];

export function TabBar() {
  const path = usePathname();
  const { data: brief } = useSWR<Brief>("/brief");
  const unseen = brief?.alerts_unseen ?? 0;

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto grid max-w-[480px] grid-cols-4">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const active = match(path);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center gap-1 text-micro font-medium transition-colors ${
                  active ? "text-ink" : "text-ink-3 hover:text-ink-2"
                }`}
              >
                <span className="relative">
                  <Icon active={active} />
                  {href === "/alerts" && unseen > 0 && (
                    <span className="num absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                      {unseen}
                    </span>
                  )}
                </span>
                {label}
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type IconProps = { active: boolean };
const stroke = (active: boolean) => ({ strokeWidth: active ? 2 : 1.6 });

function BriefIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" {...stroke(active)}>
      <rect x="4" y="3.5" width="16" height="17" rx="3" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" />
    </svg>
  );
}
function HoldingsIcon({ active }: IconProps) {
  // A shield: the holdings tab is where theses live.
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinejoin="round" {...stroke(active)}>
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" />
    </svg>
  );
}
function AskIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" {...stroke(active)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}
function AlertsIcon({ active }: IconProps) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...stroke(active)}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}
