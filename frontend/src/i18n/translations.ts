/**
 * EN/AR dictionary for the client + employee portals only (admin/staff never see
 * the language toggle, so their pages aren't in here). Keys are namespaced by
 * area. Numbers, currency, dates, and IDs are never translated — see the <Num>
 * component in LanguageContext.tsx for how those stay bidi-isolated inside
 * Arabic sentences.
 */
export type Lang = "en" | "ar";

export const translations: Record<string, Record<Lang, string>> = {
  // Nav / sidebar
  "nav.commandCenter": { en: "Command Center", ar: "لوحة التحكم" },
  "nav.documents": { en: "Documents", ar: "المستندات" },
  "nav.billing": { en: "Billing", ar: "الفواتير" },
  "nav.communications": { en: "Communications", ar: "الرسائل" },
  "nav.guide": { en: "Guide", ar: "الدليل" },
  "brand.by": { en: "by", ar: "من" },

  // Header
  "header.search": { en: "SEARCH", ar: "بحث" },
  "header.searchPlaceholder": { en: "Client, task, invoice", ar: "عميل، مهمة، فاتورة" },
  "header.searchAll": { en: "Search All", ar: "بحث شامل" },
  "header.changePassword": { en: "Change Password", ar: "تغيير كلمة المرور" },
  "header.enable2fa": { en: "Enable 2FA", ar: "تفعيل التحقق بخطوتين" },
  "header.2faOn": { en: "2FA: On", ar: "التحقق بخطوتين: مفعّل" },
  "header.signOut": { en: "Sign Out", ar: "تسجيل الخروج" },
  "header.workspace": { en: "workspace", ar: "مساحة العمل" },
  "header.language": { en: "Language", ar: "اللغة" },

  // Login
  "login.securePortal": { en: "Secure Portal", ar: "بوابة آمنة" },
  "login.clientPortal": { en: "Client Portal", ar: "بوابة العميل" },
  "login.employeePortal": { en: "Employee Portal", ar: "بوابة الموظف" },
  "login.clientCopy": { en: "Sign in to view your invoices, documents, and messages with the firm.", ar: "سجّل الدخول لعرض فواتيرك ومستنداتك ورسائلك مع المكتب." },
  "login.employeeCopy": { en: "Sign in to view your paystubs and messages from the firm.", ar: "سجّل الدخول لعرض قسائم راتبك ورسائل المكتب." },
  "login.email": { en: "Email", ar: "البريد الإلكتروني" },
  "login.password": { en: "Password", ar: "كلمة المرور" },
  "login.signIn": { en: "Sign In", ar: "تسجيل الدخول" },
  "login.signingIn": { en: "Signing in…", ar: "جاري تسجيل الدخول…" },
  "login.showPassword": { en: "Show", ar: "إظهار" },
  "login.hidePassword": { en: "Hide", ar: "إخفاء" },
  "login.forgotPassword": { en: "Forgot password?", ar: "نسيت كلمة المرور؟" },
  "login.forgotPasswordPrompt": { en: "Enter your email and we'll send you a link to reset your password.", ar: "أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة تعيين كلمة المرور." },
  "login.sendResetLink": { en: "Send reset link", ar: "إرسال رابط إعادة التعيين" },
  "login.sending": { en: "Sending…", ar: "جارٍ الإرسال…" },
  "login.backToSignIn": { en: "Back to sign in", ar: "العودة لتسجيل الدخول" },
  "login.resetLinkSent": { en: "If an account exists for that email, a reset link has been sent. Check your inbox.", ar: "إذا كان هناك حساب بهذا البريد، فقد تم إرسال رابط إعادة التعيين. تحقق من بريدك." },

  // Dashboard — Client Portal
  "dashboard.client.eyebrow": { en: "Client Portal", ar: "بوابة العميل" },
  "dashboard.client.myAccount": { en: "My Account", ar: "حسابي" },
  "dashboard.client.intro": { en: "Requested documents, invoices, reports, and messages are grouped here for quick review.", ar: "المستندات المطلوبة والفواتير والتقارير والرسائل مجمّعة هنا لمراجعة سريعة." },
  "dashboard.documents": { en: "Documents", ar: "المستندات" },
  "dashboard.billing": { en: "Billing", ar: "الفواتير" },
  "dashboard.messages": { en: "Messages", ar: "الرسائل" },
  "dashboard.client.documentRequests": { en: "Document Requests", ar: "المستندات المطلوبة" },
  "dashboard.client.openInvoices": { en: "Open Invoices", ar: "الفواتير المستحقة" },
  "dashboard.visible": { en: "visible", ar: "معروض" },
  "dashboard.client.noDocs": { en: "No open document requests.", ar: "لا توجد مستندات مطلوبة حالياً." },
  "dashboard.client.noInvoices": { en: "No open invoices.", ar: "لا توجد فواتير مستحقة." },

  // Dashboard — Employee Portal
  "dashboard.employee.eyebrow": { en: "Employee Portal", ar: "بوابة الموظف" },
  "dashboard.employee.myPay": { en: "My Pay", ar: "راتبي" },
  "dashboard.employee.intro": { en: "View paystubs shared by payroll. Contact the firm through messages if something needs review.", ar: "اطّلع على قسائم الراتب التي يشاركها قسم الرواتب. تواصل مع المكتب عبر الرسائل إذا احتجت لمراجعة أي شيء." },
  "dashboard.employee.profile": { en: "Profile", ar: "الملف الشخصي" },
  "dashboard.employee.email": { en: "Email", ar: "البريد الإلكتروني" },
  "dashboard.employee.employer": { en: "Employer", ar: "جهة العمل" },
  "dashboard.employee.employeeId": { en: "Employee ID", ar: "رقم الموظف" },
  "dashboard.employee.latestPaystub": { en: "Latest Paystub", ar: "آخر قسيمة راتب" },
  "dashboard.employee.gross": { en: "Gross", ar: "الإجمالي" },
  "dashboard.employee.employeeTaxes": { en: "Employee Taxes", ar: "ضرائب الموظف" },
  "dashboard.employee.netPay": { en: "Net Pay", ar: "صافي الراتب" },
  "dashboard.employee.employerCost": { en: "Employer Cost", ar: "تكلفة صاحب العمل" },
  "dashboard.employee.paystubs": { en: "Paystubs", ar: "قسائم الراتب" },
  "dashboard.employee.onFile": { en: "on file", ar: "مسجّلة" },
  "dashboard.employee.noPaystubs": { en: "No paystubs on file yet.", ar: "لا توجد قسائم راتب مسجّلة بعد." },
  "dashboard.employee.checkNum": { en: "Check #", ar: "شيك رقم" },
  "dashboard.employee.payDate": { en: "Pay Date", ar: "تاريخ الصرف" },
  "dashboard.employee.period": { en: "Period", ar: "الفترة" },
  "dashboard.employee.taxes": { en: "Taxes", ar: "الضرائب" },
  "dashboard.employee.status": { en: "Status", ar: "الحالة" },
  "dashboard.employee.view": { en: "View", ar: "عرض" },
  "dashboard.employee.download": { en: "Download", ar: "تحميل" },
  "dashboard.employee.opening": { en: "Opening…", ar: "جاري الفتح…" },
  "dashboard.employee.downloading": { en: "Downloading…", ar: "جاري التحميل…" },
  "common.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
};

export function translate(lang: Lang, key: string): string {
  return translations[key]?.[lang] ?? translations[key]?.en ?? key;
}
