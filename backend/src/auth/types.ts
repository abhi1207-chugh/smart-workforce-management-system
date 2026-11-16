/** KIOSK is the shared face-scan device account: recognise + face-verified punches only. */
export type UserRole = "ADMIN" | "EMPLOYEE" | "KIOSK";

/** The identity attached to a request after the JWT has been verified. */
export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  employee_id: string | null;
}
