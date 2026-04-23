import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Building2,
  Users,
  Settings,
  LogOut,
  Banknote,
  HandCoins,
  BookOpen,
} from "lucide-react";
import type { ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";
import { cn } from "../../lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const nav: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: Building2 },
  { href: "/investors", label: "Investors", icon: Users },
  { href: "/distributions", label: "Distributions", icon: Banknote },
  { href: "/capital-calls", label: "Capital Calls", icon: HandCoins },
  { href: "/admin/ledger", label: "Ledger", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const { user, logout } = useAuth();

  const isActive = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 flex-shrink-0 border-r border-coyote-200 bg-white">
        <div className="flex h-16 items-center gap-2 border-b border-coyote-200 px-5">
          <div className="h-7 w-7 rounded bg-coyote-700 text-white flex items-center justify-center text-sm font-semibold">
            C
          </div>
          <div>
            <div className="text-sm font-semibold text-coyote-900 leading-tight">
              Coyote Equity
            </div>
            <div className="text-[11px] text-coyote-500 uppercase tracking-wider">
              Investor Manager
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-3">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                  active
                    ? "bg-coyote-100 text-coyote-900 font-medium"
                    : "text-coyote-700 hover:bg-coyote-50"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-0 w-60 border-t border-coyote-200 bg-white px-3 py-3 text-sm">
          <div className="mb-2 px-2 text-xs text-coyote-500">
            Signed in as GP
            <div className="truncate text-coyote-700" title={user?.sub}>
              {user?.sub.slice(0, 8)}…
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-coyote-700 hover:bg-coyote-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-7xl p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
