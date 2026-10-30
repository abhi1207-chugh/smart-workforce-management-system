"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmployeeForm } from "@/components/EmployeeForm";
import { RequireRole } from "@/components/RequireRole";
import { api } from "@/lib/api";
import { emptyEmployeeForm, employeePayload } from "@/lib/employees";
import type { EmployeeDetail } from "@/lib/types";

export default function NewEmployeePage() {
  const router = useRouter();
  return (
    <RequireRole role="ADMIN">
      <p><Link href="/employees">← Employees</Link></p>
      <h1>Add employee</h1>
      <EmployeeForm
        mode="create"
        initial={emptyEmployeeForm}
        submitLabel="Create employee"
        onSubmit={async (values) => {
          const created = await api<EmployeeDetail>("/employees", {
            method: "POST",
            body: { ...employeePayload(values), password: values.password },
          });
          router.push(`/employees/${created.id}`);
        }}
      />
    </RequireRole>
  );
}
