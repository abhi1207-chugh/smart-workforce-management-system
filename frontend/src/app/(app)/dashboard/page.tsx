"use client";

import { AdminDashboard } from "@/components/AdminDashboard";
import { EmployeeHome } from "@/components/EmployeeHome";
import { useAuth } from "@/lib/auth";

export default function DashboardPage() {
  const { user } = useAuth();
  return (
    <>
      <h1>{user?.role === "ADMIN" ? "Admin dashboard" : "My home"}</h1>
      {user?.role === "ADMIN" ? <AdminDashboard /> : <EmployeeHome />}
    </>
  );
}
