"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { launchKiosk } from "@/lib/kiosk";
import type { Role } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

// Add an entry here as each screen is built.
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["ADMIN", "EMPLOYEE"] },
  { href: "/attendance", label: "Attendance", roles: ["ADMIN", "EMPLOYEE"] },
  { href: "/leave", label: "Leave", roles: ["ADMIN", "EMPLOYEE"] },
  { href: "/overtime", label: "Overtime", roles: ["ADMIN", "EMPLOYEE"] },
  { href: "/payslips", label: "Payslips", roles: ["EMPLOYEE"] },
  { href: "/payroll", label: "Payroll", roles: ["ADMIN"] },
  { href: "/employees", label: "Employees", roles: ["ADMIN"] },
  { href: "/reports", label: "Reports", roles: ["ADMIN", "EMPLOYEE"] },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [launchError, setLaunchError] = useState<string | null>(null);
  if (!user) return null;

  async function openKiosk() {
    setLaunchError(null);
    try {
      await launchKiosk();
    } catch (e) {
      setLaunchError(e instanceof Error ? e.message : "Could not open the kiosk");
    }
  }

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand">Smart Workforce</div>
      <ul>
        {NAV_ITEMS.filter((i) => i.roles.includes(user.role)).map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={pathname.startsWith(i.href) ? "active" : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
      {user.role === "ADMIN" && (
        <div className="kiosk-launch">
          <button className="secondary" onClick={openKiosk}>
            Open face kiosk ↗
          </button>
          {launchError && (
            <p role="alert" className="error small">
              {launchError}
            </p>
          )}
        </div>
      )}
      <div className="user-box">
        <div className="muted small">{user.email}</div>
        <span className="badge">{user.role}</span>
        <button
          className="link"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
