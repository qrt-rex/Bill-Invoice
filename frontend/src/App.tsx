import type { ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RedirectIfAuthenticated, RequireAuth, RequirePermission } from './auth';
import { Shell } from './Shell';
import { ConfirmProvider } from './ui/ConfirmDialog';
import { ThemeProvider } from './ui/ThemeContext';
import { ToastProvider } from './ui/ToastContext';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';
import { Invoices, PrintBatch } from './pages/Invoices';
import { InvoiceForm } from './pages/InvoiceForm';
import { InvoiceView } from './pages/InvoiceView';
import { Requests } from './pages/Requests';
import { QuotationForm, Quotations, QuotationView } from './pages/Quotations';
import { Customers } from './pages/Customers';
import { Payments } from './pages/Payments';
import { Reports } from './pages/Reports';
import { Documents } from './pages/Documents';
import { Settings } from './pages/Settings';

const guard = (permission: string | string[], element: ReactNode) => <RequirePermission permission={permission}>{element}</RequirePermission>;

function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-text-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold text-text">Page not found</h1>
      <Link to="/dashboard" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">Back to the billing dashboard</Link>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
                <Route element={<RequireAuth />}>
                  <Route element={<Shell />}>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/invoices" element={guard(['invoices.view', 'invoices.view_proforma', 'invoices.create_proforma', 'invoices.create_tax'], <Invoices />)} />
                    <Route path="/invoices/new" element={guard(['invoices.create_tax', 'invoices.create_proforma'], <InvoiceForm />)} />
                    <Route path="/invoices/print" element={guard('invoices.view', <PrintBatch />)} />
                    <Route path="/invoices/:id" element={<InvoiceView />} />
                    <Route path="/requests" element={guard(['requests.create', 'requests.review'], <Requests />)} />
                    <Route path="/quotations" element={guard(['quotations.create', 'quotations.view'], <Quotations />)} />
                    <Route path="/quotations/new" element={guard('quotations.create', <QuotationForm />)} />
                    <Route path="/quotations/:id" element={guard(['quotations.create', 'quotations.view'], <QuotationView />)} />
                    <Route path="/customers" element={guard('customers.view', <Customers />)} />
                    <Route path="/payments" element={guard('payments.view', <Payments />)} />
                    <Route path="/reports" element={guard('reports.view', <Reports />)} />
                    <Route path="/documents" element={guard('documents.view', <Documents />)} />
                    <Route path="/settings" element={guard(['members.manage', 'settings.manage', 'audit.view'], <Settings />)} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
