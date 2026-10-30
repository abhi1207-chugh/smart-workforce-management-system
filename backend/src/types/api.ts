export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorBody {
  code: string;
  message: string;
  details: unknown[];
}

export interface ErrorResponse {
  success: false;
  error: ErrorBody;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export interface EmployeeDto {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string;
  shift_id: string;
  status: "ACTIVE" | "INACTIVE";
  face_registered: boolean;
}

export interface EmployeeDetailDto extends EmployeeDto {
  phone: string | null;
  monthly_base_salary: string;
  hire_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface ShiftDto {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  scheduled_duration_minutes: number;
  grace_period_minutes: number;
  status: "ACTIVE" | "INACTIVE";
  weekly_off_days: string[];
}

export interface HealthDto {
  status: "ok" | "degraded";
  postgres: "ok" | "degraded" | "down";
  vector_db: "ok" | "degraded" | "down";
}

export interface AttendanceSessionDto {
  id: string;
  employee_id: string;
  work_date: string;
  check_in: string;
  check_out: string | null;
  working_duration_minutes: number | null;
  status: "CHECKED_IN" | "COMPLETED";
  is_late_arrival: boolean;
  is_early_checkout: boolean;
  correction_reason: string | null;
}

export interface DayAttendanceDto {
  work_date: string;
  classification: string;
  total_working_minutes: number;
  payable_day_fraction: string;
  is_scheduled_working_day: boolean;
}

export interface CheckOutResultDto extends AttendanceSessionDto {
  classification: string;
  day: DayAttendanceDto;
}

export interface TodayStatusDto {
  employee_id: string;
  work_date: string;
  status: "NOT_CHECKED_IN" | "CHECKED_IN" | "CHECKED_OUT";
  sessions: AttendanceSessionDto[];
  day: DayAttendanceDto | null;
}
