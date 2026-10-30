# Frontend (Next.js 15)

```bash
cd frontend && npm install
npm run dev        # http://localhost:3000 — backend must be running on :3001
npm test           # Vitest (API client)
npm run typecheck
npm run build
```

- `BACKEND_URL` (default `http://localhost:3001`) is where `/api/v1/*` is proxied (`next.config.mjs`).
- `src/lib/api.ts` — typed fetch client; returns `data` from the envelope, throws `ApiError`.
- `src/lib/auth.tsx` — `AuthProvider` / `useAuth()`; JWT kept in localStorage (see note in `api.ts`).
- Pages under `src/app/(app)/` require login; add sidebar entries in `src/components/Sidebar.tsx`.
- Dev logins: `admin@example.com` / `Admin@12345`, `aarav.sharma@example.com` / `Employee@12345`.

## Screens
| Route | Roles | Purpose |
|---|---|---|
| `/login` | public | Sign in |
| `/dashboard` | both | Admin metrics / employee home with check-in and check-out |
| `/attendance` | both | History; ADMIN adds filters, manual punch, corrections |
| `/leave`, `/overtime` | both | Requests; ADMIN reviews and overrides balances |
| `/employees`, `/employees/new`, `/employees/[id]` | ADMIN | Employee management |
| `/payroll`, `/payroll/[id]` | ADMIN | Runs, preview, finalize, adjustments, payments |
| `/payslips`, `/payslips/[id]` | EMPLOYEE (admin via run page) | Payslips |
| `/reports` | both | Admin reports and audit log / employee summary |
