import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { SelectedClientProvider } from "./context/SelectedClientContext";
import { LanguageProvider } from "./context/LanguageContext";
import { ToastProvider } from "./components/Toast";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { DashboardPage } from "./pages/DashboardPage";
import { ClientsListPage } from "./pages/ClientsListPage";
import { ClientDetailPage } from "./pages/ClientDetailPage";
import { TasksListPage } from "./pages/TasksListPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { DocumentsListPage } from "./pages/DocumentsListPage";
import { DocumentDetailPage } from "./pages/DocumentDetailPage";
import { InvoicesListPage } from "./pages/InvoicesListPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";
import { CommunicationsPage } from "./pages/CommunicationsPage";
import { AccountingPage } from "./pages/AccountingPage";
import { EmployeeDetailPage } from "./pages/EmployeeDetailPage";
import { RulesPage } from "./pages/RulesPage";
import { UsersPage } from "./pages/UsersPage";
import { SecurityPage } from "./pages/SecurityPage";
import { FixCenterPage } from "./pages/FixCenterPage";
import { FirmSettingsPage } from "./pages/FirmSettingsPage";
import { GuidePage } from "./pages/GuidePage";
import { ReportsPage } from "./pages/ReportsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { SearchResultsPage } from "./pages/SearchResultsPage";
import { PublicInvoicePage } from "./pages/PublicInvoicePage";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <LanguageProvider>
        <SelectedClientProvider>
        <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/staff" element={<LoginPage lockedPortal="staff" />} />
          <Route path="/login/client" element={<LoginPage lockedPortal="client" />} />
          <Route path="/login/employee" element={<LoginPage lockedPortal="employee" />} />
          <Route path="/accept-invite" element={<AcceptInvitePage />} />
          <Route path="/public/invoice/:token" element={<PublicInvoicePage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/documents" element={<DocumentsListPage />} />
              <Route path="/documents/:requestId" element={<DocumentDetailPage />} />
              <Route path="/communications" element={<CommunicationsPage />} />
              <Route path="/search" element={<SearchResultsPage />} />
              <Route path="/guide" element={<GuidePage />} />
              <Route element={<ProtectedRoute roles={["admin"]} />}>
                <Route path="/users" element={<UsersPage />} />
                <Route path="/security" element={<SecurityPage />} />
                <Route path="/fix-center" element={<FixCenterPage />} />
                <Route path="/firm-settings" element={<FirmSettingsPage />} />
              </Route>
              {/* Employees have no billing relationship with the firm — only their employer
                  (the client) does. Employees are paid via payroll, not invoiced. */}
              <Route element={<ProtectedRoute roles={["admin", "staff", "client"]} />}>
                <Route path="/billing" element={<InvoicesListPage />} />
                <Route path="/billing/:invoiceId" element={<InvoiceDetailPage />} />
              </Route>
              <Route element={<ProtectedRoute roles={["admin", "staff"]} />}>
                <Route path="/clients" element={<ClientsListPage />} />
                <Route path="/clients/:clientId" element={<ClientDetailPage />} />
                <Route path="/tasks" element={<TasksListPage />} />
                <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
                <Route path="/accounting" element={<AccountingPage />} />
                <Route path="/employees/:employeeId" element={<EmployeeDetailPage />} />
                <Route path="/rules" element={<RulesPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </ToastProvider>
        </SelectedClientProvider>
        </LanguageProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
