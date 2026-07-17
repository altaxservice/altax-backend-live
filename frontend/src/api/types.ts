export type PortalRole = "admin" | "staff" | "client" | "employee" | "general";

export interface AuthUser {
  role: PortalRole;
  email: string;
  name: string;
  userId: string;
  clientId: string;
  clientName: string;
  employeeId: string;
  employeeName: string;
  mustResetPassword: boolean;
  totpEnabled: boolean;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export type LoginStepResponse = LoginResponse | { totpRequired: true; challenge: string };

export interface Client {
  client_id: string;
  client_name: string;
  entity_type: string | null;
  status: string | null;
  state: string | null;
  email: string | null;
  phone: string | null;
  assigned_to: string | null;
  portal_enabled: boolean;
  client_type: string | null;
  service_type: string | null;
  sales_tax_frequency: string | null;
  payroll_enabled: boolean;
  payroll_frequency: string | null;
  [key: string]: unknown;
}

export interface Task {
  task_id: string;
  client_id: string;
  client_name: string;
  service_line: string | null;
  task_name: string;
  period: string | null;
  frequency: string | null;
  agency_due_date: string | null;
  staff_due_date: string | null;
  status: string;
  assigned_to: string | null;
  payment_required: boolean;
  payment_amount: number | null;
  filed_date: string | null;
  paid_date: string | null;
  confirmation_number: string | null;
  portal_name: string | null;
  portal_url: string | null;
  notes: string | null;
  file_count?: number;
  first_file_name?: string | null;
  first_file_url?: string | null;
  [key: string]: unknown;
}
