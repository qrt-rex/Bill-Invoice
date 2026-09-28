export type InvoiceType = 'invoice' | 'proforma';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'not_tracked' | 'proforma';

export interface Branch {
  key: string;
  prefix: string;
  display_name: string;
  legal_name: string;
  address: string;
  phone: string;
}

export interface Meta {
  branches: Branch[];
  settings: Record<string, string>;
  states: string[];
  home_state: string;
  payment_modes: string[];
  roles: { id: string; label: string }[];
}

export interface InvoiceSummary {
  id: number;
  invoice_number: string;
  invoice_type: InvoiceType;
  invoice_date: string;
  billing_name: string;
  branch_key: string;
  client_gstin: string;
  grand_total: number;
  paid: number;
  balance: number;
  payment_status: PaymentStatus;
  created_by_name: string;
  age_days?: number;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  paid_on: string;
  mode: string;
  reference: string;
  note: string;
  recorded_by_email: string;
  invoice_number?: string;
  billing_name?: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  billing_address: string;
  billing_phone: string;
  client_state: string;
  sub_total: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  igst_rate: number;
  igst_amount: number;
  remark: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_ifsc_code: string;
  bank_upi_id: string;
  created_by_email: string;
  request_id: number | null;
  payment_tracked: boolean;
  items: { id: number; particulars: string; hsn: string; quantity: number; rate: number; amount: number }[];
  payments: Payment[];
}

export interface InvoiceRequest {
  id: number;
  requested_by_email: string;
  requested_by_name: string;
  billing_name: string;
  billing_address: string;
  billing_phone: string;
  client_gstin: string;
  client_state: string;
  branch_key: string;
  remark: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by_email: string;
  invoice_id: number | null;
  created_at: string;
  estimated_total: number;
  items?: { particulars: string; quantity: number; rate: number }[];
}

export interface Quotation {
  id: number;
  client_name: string;
  client_phone: string;
  client_email: string;
  quotation_date: string;
  total_amount: number;
  payment_terms: string;
  employee_name: string;
  employee_phone: string;
  employee_email: string;
  created_by_email: string;
  services?: { service_name: string; amount: number; remarks: string }[];
}

export interface Paged<T> {
  total: number;
  page: number;
  page_size: number;
  items: T[];
}
