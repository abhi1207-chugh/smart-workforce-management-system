"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
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
  if (!user) return null;

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
