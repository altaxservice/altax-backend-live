import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { APP_NAME } from "../../common/branding";
import { clientMatchesRule, isActiveFlag } from "../rules/rules.routes";
import { canAccessClient } from "../../common/assignment";

export const templatesRouter = Router();

/**
 * Built-in default templates — mirrors the legacy app's hardcoded template set
 * (Client Follow Up, Payment Reminder, etc). These aren't seeded into v3_templates;
 * they're a code-level fallback exactly like legacy's "Built-in default" source,
 * so a fresh install has usable templates without a data migration. Saving a
 * template with the same name creates/updates a v3_templates row that overrides it.
 */
export const BUILT_IN: { name: string; category: string; subject: string; english: string; arabic: string }[] = [
  { name: "Appointment Confirmation", category: "Communications", subject: "🎉 Confirmed: {{appointmentDate}} at {{appointmentTime}} — {{appointmentTitle}}",
    english: "Hi {{clientName}},\n\nYou're all set! We've saved your spot for \"{{appointmentTitle}}\" on {{appointmentDate}} at {{appointmentTime}}{{appointmentLocation}}.\n\nWe're genuinely looking forward to sitting down with you. If anything comes up, use the button below anytime to reschedule or cancel — no call needed.\n\nSee you soon,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nتم حجز موعدكم بنجاح! لقد حجزنا لكم \"{{appointmentTitle}}\" بتاريخ {{appointmentDate}} الساعة {{appointmentTime}}{{appointmentLocationAr}}.\n\nنتطلع بكل سرور للقائكم. إذا طرأ أي تغيير، يمكنكم استخدام الزر أدناه في أي وقت لإعادة الجدولة أو الإلغاء دون الحاجة للاتصال بنا.\n\nنراكم قريباً،\nفريق AL TAX SERVICE" },
  { name: "Appointment Reminder", category: "Communications", subject: "⏰ Reminder: {{appointmentDate}} at {{appointmentTime}} — {{appointmentTitle}}",
    english: "Hi {{clientName}},\n\nJust a friendly heads-up — your appointment \"{{appointmentTitle}}\" is coming up on {{appointmentDate}} at {{appointmentTime}}{{appointmentLocation}}. We can't wait to see you!\n\nIf your plans changed, you can reschedule or cancel anytime using the button below.\n\nSee you then,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nهذا تذكير ودي بموعدكم \"{{appointmentTitle}}\" يوم {{appointmentDate}} الساعة {{appointmentTime}}{{appointmentLocationAr}}. يسعدنا لقاؤكم قريباً!\n\nإذا تغيرت خططكم، يمكنكم إعادة الجدولة أو الإلغاء في أي وقت عبر الزر أدناه.\n\nنراكم قريباً،\nفريق AL TAX SERVICE" },
  { name: "Appointment Confirmation Request", category: "Communications", subject: "Please confirm: {{appointmentDate}} at {{appointmentTime}} — {{appointmentTitle}}",
    english: "Hi {{clientName}},\n\nYour appointment \"{{appointmentTitle}}\" is tomorrow, {{appointmentDate}} at {{appointmentTime}}{{appointmentLocation}}. Could you confirm you're still able to make it?\n\nUse the button below to confirm, pick a new time, or reach us directly if anything's come up — whichever's easiest.\n\nLooking forward to it,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nموعدكم \"{{appointmentTitle}}\" غداً، بتاريخ {{appointmentDate}} الساعة {{appointmentTime}}{{appointmentLocationAr}}. هل يمكنكم تأكيد قدرتكم على الحضور؟\n\nاستخدموا الزر أدناه للتأكيد، أو اختيار موعد جديد، أو التواصل معنا مباشرة إذا طرأ أي أمر — أيهما أنسب لكم.\n\nنتطلع للقائكم،\nفريق AL TAX SERVICE" },
  { name: "Appointment Rescheduled", category: "Communications", subject: "Updated: {{appointmentTitle}} is now {{appointmentDate}} at {{appointmentTime}}",
    english: "Hi {{clientName}},\n\nYour appointment \"{{appointmentTitle}}\" has a new time: {{appointmentDate}} at {{appointmentTime}}{{appointmentLocation}} (previously {{previousDate}} at {{previousTime}}).\n\nPlease make a note of the change. If this new time doesn't work, use the button below to pick another or reach out and we'll sort it out.\n\nSee you then,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nتم تحديد موعد جديد لـ \"{{appointmentTitle}}\": {{appointmentDate}} الساعة {{appointmentTime}}{{appointmentLocationAr}} (بدلاً من {{previousDate}} الساعة {{previousTime}}).\n\nيرجى تدوين هذا التغيير. إذا لم يكن هذا الموعد الجديد مناسباً، استخدموا الزر أدناه لاختيار وقت آخر أو تواصلوا معنا وسنرتب الأمر.\n\nنراكم قريباً،\nفريق AL TAX SERVICE" },
  { name: "Appointment Cancelled", category: "Communications", subject: "Cancelled: {{appointmentDate}} at {{appointmentTime}} — {{appointmentTitle}}",
    english: "Hi {{clientName}},\n\nYour appointment \"{{appointmentTitle}}\" on {{appointmentDate}} at {{appointmentTime}} has been cancelled.\n\nNo worries at all — whenever you're ready, we'd love to have you back. Just pick a new time using the button below, or reply to this message and we'll take care of it.\n\nWarmly,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nتم إلغاء موعدكم \"{{appointmentTitle}}\" الذي كان مقرراً بتاريخ {{appointmentDate}} الساعة {{appointmentTime}}.\n\nلا داعي للقلق — يسعدنا استقبالكم من جديد في أي وقت يناسبكم. اختاروا موعداً جديداً عبر الزر أدناه، أو ردّوا على هذه الرسالة وسنتولى الأمر.\n\nبكل ود،\nفريق AL TAX SERVICE" },
  { name: "Appointment Completed", category: "Communications", subject: "Thanks for coming in — {{appointmentTitle}}",
    english: "Hi {{clientName}},\n\nThank you for coming in for \"{{appointmentTitle}}\" — it was great to see you. If anything comes up or you think of a question afterward, just reply to this message or give us a call.\n\nWhenever you're ready for your next visit, use the button below to book a time.\n\nThanks again,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nشكراً لحضوركم موعد \"{{appointmentTitle}}\" — كان من دواعي سرورنا لقاؤكم. إذا طرأ أي أمر أو خطر ببالكم سؤال لاحقاً، فقط ردّوا على هذه الرسالة أو اتصلوا بنا.\n\nمتى ما كنتم جاهزين لزيارتكم القادمة، استخدموا الزر أدناه لحجز موعد.\n\nشكراً لكم مجدداً،\nفريق AL TAX SERVICE" },
  { name: "Bank Statement Request", category: "Communications", subject: "Bank statement needed to continue your bookkeeping",
    english: "Hello {{clientName}},\n\nTo keep your bookkeeping and reconciliation on track, we need a copy of your most recent bank statement(s). Please upload them through your client portal, or reply to this message with them attached.\n\nThank you for helping us keep your books current.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nلمواصلة أعمال المحاسبة والتسوية الخاصة بكم دون انقطاع، نحتاج إلى نسخة من كشف/كشوفات حسابكم المصرفي الأخيرة. يرجى رفعها عبر بوابة العميل، أو إرفاقها عند الرد على هذه الرسالة.\n\nشكراً لتعاونكم في إبقاء سجلاتكم المحاسبية محدّثة.\n\nفريق AL TAX SERVICE" },
  { name: "Client Follow Up", category: "Communications", subject: "Checking in — anything we can help with?",
    english: "Hi {{clientName}},\n\nJust checking in on your account — everything on track on your end? If you have any questions, an upcoming deadline you'd like to talk through, or anything at all we can help with, just reply to this message or give us a call.\n\nTalk soon,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nنتواصل معكم للاطمئنان على وضع حسابكم — هل كل شيء يسير كما هو مخطط؟ إذا كان لديكم أي استفسار، أو موعد نهائي قادم تودّون مناقشته، أو أي شيء يمكننا مساعدتكم فيه، فقط ردّوا على هذه الرسالة أو اتصلوا بنا.\n\nنتحدث قريباً،\nفريق AL TAX SERVICE" },
  { name: "Client Tax and Payroll Update", category: "Communications", subject: "Your tax and payroll update{{periodLabel}}",
    english: "Hello {{clientName}},\n\nHere is your tax and payroll update{{periodLabel}}:\n\n{{periodSummary}}\n\nLet us know if you have any questions about any of this.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nإليكم تحديث الضرائب والرواتب الخاص بكم{{periodLabelAr}}:\n\n{{periodSummaryAr}}\n\nيرجى إعلامنا إذا كان لديكم أي استفسار حول أي مما ورد أعلاه.\n\nفريق AL TAX SERVICE" },
  { name: "Direct Deposit Question", category: "Communications", subject: "A quick question about your direct deposit",
    english: "Hello,\n\nWe have a quick question about your direct deposit setup and want to make sure everything is entered correctly before your next payment goes out. Could you reply to this message or give us a call at your earliest convenience?\n\nThank you.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً،\n\nلدينا سؤال سريع بخصوص إعدادات الإيداع المباشر الخاصة بكم، ونود التأكد من صحة جميع البيانات قبل صرف دفعتكم القادمة. يرجى الرد على هذه الرسالة أو الاتصال بنا في أقرب وقت ممكن.\n\nشكراً لكم.\n\nفريق AL TAX SERVICE" },
  { name: "Document Request", category: "Communications", subject: "Documents needed to continue",
    english: "Hello {{clientName}},\n\nWe need the following from you to continue:\n\n{{itemsList}}\n\nPlease upload these through your client portal or reply to this message with them attached. Let us know if you have any questions about what's needed.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nنحتاج إلى ما يلي منكم للمتابعة:\n\n{{itemsList}}\n\nيرجى رفعها عبر بوابة العميل الخاصة بكم، أو إرفاقها عند الرد على هذه الرسالة. لا تترددوا في التواصل إذا كان لديكم أي استفسار حول ما هو مطلوب.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Document Upload Note", category: "Communications", subject: "New documents ready for your review",
    english: "Hello {{clientName}},\n\nWe've uploaded new documents to your account. Please log in to your client portal to review them, and let us know if you have any questions.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nقمنا برفع مستندات جديدة إلى حسابكم. يرجى تسجيل الدخول إلى بوابة العميل لمراجعتها، ولا تترددوا في التواصل معنا إذا كان لديكم أي استفسار.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Employee Paystub Notice", category: "Communications", subject: "Your paystub is ready to view",
    english: "Hello,\n\nYour latest paystub is now available for review in your employee portal. Please log in to view it, and let us know if anything looks off.\n\nThank you.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً،\n\nقسيمة راتبكم الأخيرة متوفرة الآن للمراجعة في بوابة الموظف الخاصة بكم. يرجى تسجيل الدخول للاطلاع عليها، وإعلامنا في حال وجود أي ملاحظة.\n\nشكراً لكم.\n\nفريق AL TAX SERVICE" },
  { name: "Employee Paystub Question", category: "Communications", subject: "A question about your paystub",
    english: "Hello,\n\nWe have a question about your recent paystub and want to make sure it's accurate. Could you reply to this message or give us a call at your earliest convenience?\n\nThank you.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً،\n\nلدينا سؤال بخصوص قسيمة راتبكم الأخيرة، ونود التأكد من دقتها. يرجى الرد على هذه الرسالة أو الاتصال بنا في أقرب وقت ممكن.\n\nشكراً لكم.\n\nفريق AL TAX SERVICE" },
  { name: "ID Verification Request", category: "Communications", subject: "ID verification needed",
    english: "Hello {{clientName}},\n\nFor verification purposes, please upload a copy of a valid, government-issued photo ID through your client portal.\n\nThank you for helping us keep your file secure and up to date.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nلأغراض التحقق، يرجى رفع نسخة من بطاقة هوية سارية صادرة عن جهة حكومية تحمل صورتكم عبر بوابة العميل.\n\nشكراً لتعاونكم في الحفاظ على ملفكم آمناً ومحدّثاً.\n\nفريق AL TAX SERVICE" },
  { name: "Missing Information", category: "Communications", subject: "A few details still needed on your account",
    english: "Hello {{clientName}},\n\nWe reviewed the documents you sent and found a few details that are still missing or unclear. Please reply to this message or give us a call so we can sort them out together — the sooner we hear from you, the sooner we can move forward.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nراجعنا المستندات التي أرسلتموها ولاحظنا وجود بعض التفاصيل لا تزال ناقصة أو غير واضحة. يرجى الرد على هذه الرسالة أو الاتصال بنا لاستكمالها معاً — كلما تواصلتم معنا أسرع، كلما تمكّنا من المتابعة أسرع.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Payment Question", category: "Communications", subject: "A quick question about a recent payment",
    english: "Hello,\n\nWe have a quick question about a recent payment on your account. Could you reply to this message or give us a call at your earliest convenience so we can sort it out?\n\nThank you.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً،\n\nلدينا سؤال سريع بخصوص دفعة أخيرة على حسابكم. يرجى الرد على هذه الرسالة أو الاتصال بنا في أقرب وقت ممكن لإيضاح الأمر.\n\nشكراً لكم.\n\nفريق AL TAX SERVICE" },
  { name: "Payment Reminder", category: "Communications", subject: "Payment reminder — balance due {{balanceDue}}",
    english: "Hello {{clientName}},\n\nThis is a reminder that you have an outstanding balance of {{balanceDue}}. Please arrange payment at your earliest convenience — reply to this message if you have any questions or need to discuss payment options.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nهذا تذكير بأن لديكم رصيداً مستحقاً غير مسدد بقيمة {{balanceDue}}. يرجى ترتيب السداد في أقرب وقت ممكن — وإذا كان لديكم أي استفسار أو رغبتم بمناقشة خيارات الدفع، يرجى الرد على هذه الرسالة.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Payroll Summary", category: "Communications", subject: "Your payroll summary{{periodLabel}}",
    english: "Hello {{clientName}},\n\nHere is your payroll summary{{periodLabel}}:\n\n{{periodSummary}}\n\nLet us know if you have any questions about any of this.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nإليكم ملخص الرواتب الخاص بكم{{periodLabelAr}}:\n\n{{periodSummaryAr}}\n\nيرجى إعلامنا إذا كان لديكم أي استفسار حول أي مما ورد أعلاه.\n\nفريق AL TAX SERVICE" },
  { name: "Payroll Tax Question", category: "Communications", subject: "A question about your payroll taxes",
    english: "Hello,\n\nWe have a question about your payroll taxes and want to make sure everything is filed correctly. Could you reply to this message or give us a call at your earliest convenience?\n\nThank you.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً،\n\nلدينا سؤال بخصوص ضرائب الرواتب الخاصة بكم، ونود التأكد من صحة تقديمها. يرجى الرد على هذه الرسالة أو الاتصال بنا في أقرب وقت ممكن.\n\nشكراً لكم.\n\nفريق AL TAX SERVICE" },
  { name: "Question to AL TAX", category: "Communications", subject: "New question from the client portal",
    english: "A client submitted a question through the client portal. Please review it and follow up directly.",
    arabic: "قام أحد العملاء بإرسال استفسار عبر بوابة العميل. يرجى مراجعته والتواصل معه مباشرة." },
  { name: "Refund Notice", category: "Communications", subject: "An update on your refund",
    english: "Hello {{clientName}},\n\nWe have an update regarding your refund. Please reply to this message or contact our office and we'll walk you through the details.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nلدينا تحديث بخصوص المبلغ المسترد الخاص بكم. يرجى الرد على هذه الرسالة أو التواصل مع مكتبنا وسنوضح لكم التفاصيل.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Request Information", category: "Communications", subject: "A bit more information needed from you",
    english: "Hello {{clientName}},\n\nWe need a bit more information from you to move forward. Please reply to this message or call our office at your earliest convenience — we're happy to walk through it together if that's easier.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nنحتاج إلى بعض المعلومات الإضافية منكم للمتابعة. يرجى الرد على هذه الرسالة أو الاتصال بمكتبنا في أقرب وقت ممكن — يسعدنا مراجعة الأمر معكم مباشرة إذا كان ذلك أنسب.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Sales Tax Summary", category: "Communications", subject: "Your sales tax summary{{periodLabel}}",
    english: "Hello {{clientName}},\n\nHere is your sales tax summary{{periodLabel}}:\n\n{{periodSummary}}\n\nLet us know if you have any questions about any of this.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nإليكم ملخص ضريبة المبيعات الخاص بكم{{periodLabelAr}}:\n\n{{periodSummaryAr}}\n\nيرجى إعلامنا إذا كان لديكم أي استفسار حول أي مما ورد أعلاه.\n\nفريق AL TAX SERVICE" },
  { name: "Signature Required", category: "Communications", subject: "Your signature is needed",
    english: "Hello {{clientName}},\n\nA document is waiting for your signature in your client portal. Please review and sign it at your earliest convenience so we can keep things moving.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nهناك مستند بانتظار توقيعكم في بوابة العميل الخاصة بكم. يرجى مراجعته وتوقيعه في أقرب وقت ممكن حتى نتمكن من مواصلة العمل.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Staff Task Reminder", category: "Communications", subject: "Task reminder: {{taskName}}",
    english: `Task: {{taskName}}\nClient: {{clientName}}\nStatus: {{taskStatus}}\nDue: {{dueDate}}\n\nPlease review and update this task in ${APP_NAME}.`,
    arabic: `المهمة: {{taskName}}\nالعميل: {{clientName}}\nالحالة: {{taskStatus}}\nتاريخ الاستحقاق: {{dueDate}}\n\nيرجى مراجعة هذه المهمة وتحديثها في نظام ${APP_NAME}.` },
  { name: "Tax Return Ready for Review", category: "Communications", subject: "Your tax return is ready for review",
    english: "Hello {{clientName}},\n\nYour tax return is ready for review. Please log in to your client portal to review and sign it, or reply to this message with any questions first.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nإقراركم الضريبي جاهز للمراجعة. يرجى تسجيل الدخول إلى بوابة العميل الخاصة بكم لمراجعته وتوقيعه، أو الرد على هذه الرسالة أولاً في حال وجود أي استفسار.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "W-9 Request", category: "Communications", subject: "W-9 form needed",
    english: "Hello {{clientName}},\n\nWe need a completed Form W-9 on file for you. Please upload a signed copy through your client portal or reply to this message with it attached.\n\nThank you,\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nنحتاج إلى نموذج W-9 موقّع ومكتمل لحفظه في ملفكم. يرجى رفع نسخة موقعة عبر بوابة العميل، أو إرفاقها عند الرد على هذه الرسالة.\n\nشكراً لكم،\nفريق AL TAX SERVICE" },
  { name: "Welcome New Client", category: "Communications", subject: "Welcome to AL TAX SERVICE",
    english: "Hello {{clientName}},\n\nWelcome to AL TAX SERVICE! We're glad to have you as a client. You can access your documents, invoices, and messages anytime through your client portal.\n\nLet us know if you have any questions as we get started — we're here to help.\n\nThe AL TAX SERVICE Team",
    arabic: "مرحباً {{clientName}}،\n\nنرحب بكم في AL TAX SERVICE! يسعدنا انضمامكم كعميل لدينا. يمكنكم الوصول إلى مستنداتكم وفواتيركم ورسائلكم في أي وقت عبر بوابة العميل الخاصة بكم.\n\nلا تترددوا في التواصل إذا كان لديكم أي استفسار ونحن نبدأ معاً — نحن هنا لمساعدتكم.\n\nفريق AL TAX SERVICE" },
];

templatesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const overrides = await query<any>(`SELECT * FROM altax.v3_templates ORDER BY template_name ASC`);
  const overrideByName = new Map(overrides.map((r: any) => [r.template_name.toLowerCase(), r]));

  const templates = BUILT_IN.map((b) => {
    const override = overrideByName.get(b.name.toLowerCase());
    overrideByName.delete(b.name.toLowerCase());
    if (override) {
      return { templateId: override.template_id, name: override.template_name, category: override.category, subject: override.subject, active: override.active, source: "Custom override" };
    }
    return { templateId: null, name: b.name, category: b.category, subject: b.subject, active: true, source: "Built-in default" };
  });

  for (const remaining of overrideByName.values()) {
    templates.push({ templateId: remaining.template_id, name: remaining.template_name, category: remaining.category, subject: remaining.subject, active: remaining.active, source: "Custom" });
  }

  res.json({ templates });
}));

/**
 * Resolves {{placeholder}} tokens against a client (and, loosely, the firm)
 * before a template is handed to the compose UI. Previously the frontend
 * copied template text verbatim into the message box, so every built-in
 * template's {{clientName}} (and any custom template's own tokens) went out
 * unresolved — this closes that gap without requiring the caller to know
 * which tokens exist; unknown tokens are left as-is rather than blanked, so
 * a typo'd placeholder is visibly wrong instead of silently disappearing.
 */
export function substitutePlaceholders(text: string, client: any | null, extra?: Record<string, string>): string {
  if (!text) return text;
  const today = new Date();
  const values: Record<string, string> = {
    firmName: "AL TAX SERVICE",
    today: `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`,
    clientName: client?.client_name || "",
    clientEmail: client?.email || "",
    clientPhone: client?.phone || "",
    balanceDue: client?.balance_due !== undefined && client?.balance_due !== null
      ? `$${Number(client.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "",
    periodLabel: "", periodLabelAr: "", periodSummary: "", periodSummaryAr: "",
    ...extra,
  };
  const blankable = new Set([
    "{{periodLabel}}", "{{periodLabelAr}}", "{{periodSummary}}", "{{periodSummaryAr}}",
    "{{appointmentLocation}}", "{{appointmentLocationAr}}",
    "{{previousDate}}", "{{previousTime}}",
  ]);
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value !== undefined && value !== "" ? value : blankable.has(match) ? "" : match;
  });
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(v: unknown): string {
  const d = v ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { timeZone: "UTC" }) : "";
}

/**
 * Projects the filing/payment due date a Task Rule implies for a given reporting
 * period, from its `due_month`/`due_day` config columns — the same two columns
 * `POST /rules/:ruleId/batch` leaves for staff to fill in by hand every time. Real
 * production values (checked directly against v3_task_rules) are one of: "Next
 * Month" (monthly rules — due the following calendar month), "Current Month" (TR-005
 * only), "Quarter End" / "Quarter End + 1" (quarterly rules), a bare numeric month
 * string like "4" (annual rules — fixed calendar month, due the year AFTER the tax
 * year closes, e.g. a 2025 return due April 15 2026), or null (Custom/Once rules,
 * which have no projectable due date and are skipped by the caller). Quarterly rules
 * with no `due_month` set (only TR-014Q today) fall back to "Quarter End + 1" since
 * that's what every other quarterly rule in production actually uses.
 */
function projectRuleDueDate(rule: any, periodEnd: Date): Date | null {
  const dueDay = Number(String(rule.due_day || "").trim());
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return null;
  const dueMonth = String(rule.due_month || "").trim();
  const y = periodEnd.getUTCFullYear();
  const m = periodEnd.getUTCMonth();
  const quarterEndMonth = Math.floor(m / 3) * 3 + 2; // 0-indexed: Mar=2, Jun=5, Sep=8, Dec=11

  if (dueMonth === "Next Month") return new Date(Date.UTC(y, m + 1, dueDay));
  if (dueMonth === "Current Month") return new Date(Date.UTC(y, m, dueDay));
  if (dueMonth === "Quarter End") return new Date(Date.UTC(y, quarterEndMonth, dueDay));
  if (dueMonth === "Quarter End + 1") return new Date(Date.UTC(y, quarterEndMonth + 1, dueDay));
  if (!dueMonth && rule.frequency === "Quarterly") return new Date(Date.UTC(y, quarterEndMonth + 1, dueDay));

  const fixedMonth = Number(dueMonth);
  if (Number.isFinite(fixedMonth) && fixedMonth >= 1 && fixedMonth <= 12) {
    return new Date(Date.UTC(y + 1, fixedMonth - 1, dueDay));
  }
  return null;
}

/**
 * Real, computed "Important Dates" — which active Task Rules this specific client
 * matches (same trigger logic `POST /rules/:ruleId/batch` uses to pick clients for a
 * batch run) and what due date each implies for the period just reported on. Requires
 * the FULL client row (every trigger column `clientMatchesRule` might check), not the
 * client_id/name/email/phone slice `resolveTemplate` normally fetches.
 */
async function computeImportantDates(client: any, periodEnd: Date): Promise<{ label: string; date: Date }[]> {
  const rules = await query<any>(`SELECT * FROM altax.v3_task_rules WHERE frequency <> 'Once'`);
  // Two rules can legitimately share a task_type — e.g. TR-005 ("Payroll Processing",
  // triggers on a specific Payroll Frequency) and TR-005A (same task_type, triggers on
  // Payroll?=Yes as TR-013's prerequisite step) — and both match any client with
  // payroll_enabled=true AND payroll_frequency=Monthly (65 real clients). When that
  // happens they usually project the identical due date too, so dedupe on label+date
  // rather than showing the same line twice; two rules with the same label but a
  // genuinely different projected date both stay, since that's real information.
  const seen = new Set<string>();
  const dates: { label: string; date: Date }[] = [];
  for (const rule of rules) {
    if (!isActiveFlag(rule.active)) continue;
    if (!clientMatchesRule(client, rule)) continue;
    const due = projectRuleDueDate(rule, periodEnd);
    if (!due) continue;
    const label = String(rule.task_type || rule.rule_id);
    const key = `${label}|${due.toISOString().slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dates.push({ label, date: due });
  }
  dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return dates;
}

interface PeriodFigures {
  sales: any[];
  paychecks: any[];
  salesTaxDue: number;
  grossSales: number;
  grossWages: number;
  employeeTaxes: number;
  employerTaxes: number;
  netPay: number;
  totalPayrollCost: number;
  adjustments: number;
  byCategory: [string, { taxable: number; tax: number }][];
  lastPayment: string | null;
  federalWithholding: number;
  socialSecurityEe: number;
  socialSecurityEr: number;
  medicareEe: number;
  medicareEr: number;
  stateTax: number;
  suta: number;
  importantDates: { label: string; date: Date }[];
  mdFiling: (import("../../common/mdFiling").MdFilingResult & { dueDate: string; filedDate: string; paidDate: string }) | null;
}

/**
 * The real, computed sales-tax + payroll figures for a client's period — shared by
 * both computeClientPeriodSummary (plain-text, for SMS/WhatsApp/the {{periodSummary}}
 * token) and computeClientPeriodSummaryTable (bilingual structured rows, for the
 * Reports "Client Message" table and the new Sales, Tax & Payroll report) so the two
 * presentations can never drift into showing different numbers for the same period.
 */
async function fetchPeriodFigures(clientId: string, periodStart: string, periodEnd: string, mdFiledDate?: string, mdPaidDate?: string): Promise<PeriodFigures> {
  const sales = await query<any>(
    `SELECT * FROM altax.v3_sales_input WHERE client_id = $1 AND sale_date BETWEEN $2 AND $3 ORDER BY sale_date ASC`,
    [clientId, periodStart, periodEnd]
  );
  const paychecks = await query<any>(
    `SELECT * FROM altax.v3_paychecks WHERE client_id = $1 AND pay_date BETWEEN $2 AND $3 ORDER BY pay_date ASC`,
    [clientId, periodStart, periodEnd]
  );

  const sum = (rows: any[], col: string) => rows.reduce((s, r) => s + Number(r[col] || 0), 0);

  // Category breakdown reads v3_sales_input_lines (multi-state/multi-category,
  // 2026-07-14) rather than the old fixed taxable6_sales/special12_sales/
  // vape20_sales/sixty_rate_sales columns — those stay populated on legacy rows for
  // audit purposes but are no longer written to, so summing them here would silently
  // miss every sale recorded after the migration.
  const saleIds = sales.map((s) => s.sale_id);
  const lineRows = saleIds.length
    ? await query<any>(
        `SELECT l.taxable_amount, l.tax_amount, c.category_name FROM altax.v3_sales_input_lines l
         JOIN altax.v3_sales_tax_categories c ON c.category_id = l.category_id
         WHERE l.sale_id = ANY($1::text[]) ORDER BY c.display_order`,
        [saleIds]
      )
    : [];
  const byCategoryMap = new Map<string, { taxable: number; tax: number }>();
  for (const l of lineRows) {
    const entry = byCategoryMap.get(l.category_name) || { taxable: 0, tax: 0 };
    entry.taxable += Number(l.taxable_amount) || 0;
    entry.tax += Number(l.tax_amount) || 0;
    byCategoryMap.set(l.category_name, entry);
  }

  const periodEndDate = new Date(periodEnd);
  let importantDates: { label: string; date: Date }[] = [];
  const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!Number.isNaN(periodEndDate.getTime())) {
    importantDates = client ? await computeImportantDates(client, periodEndDate) : [];
  }

  // Maryland Form 202 Line 18/37 discount/penalty/interest — same formulas
  // the Calculator and Accounting → Sales Input use (computeMdFiling), so a
  // client's actual filing amount shows up wherever their sales tax is
  // reported, not only in those two working-tool views. Due date is derived
  // from the period itself (mdDueDateForPeriod), not "today" — a report
  // covers a fixed past/future period with a fixed statutory due date.
  // Paid date defaults to today (the date this summary is being generated),
  // same convention the Calculator/Sales Input use for their own default.
  const salesTaxDue = sum(sales, "total_tax_due");
  let mdFiling: PeriodFigures["mdFiling"] = null;
  if (client?.state === "MD" && salesTaxDue > 0 && !Number.isNaN(periodEndDate.getTime())) {
    const { computeMdFiling, mdDueDateForPeriod } = await import("../../common/mdFiling");
    const dueDate = mdDueDateForPeriod(periodEnd);
    const today = new Date().toISOString().slice(0, 10);
    const filedDate = mdFiledDate && /^\d{4}-\d{2}-\d{2}$/.test(mdFiledDate) ? mdFiledDate : today;
    const paidDate = mdPaidDate && /^\d{4}-\d{2}-\d{2}$/.test(mdPaidDate) ? mdPaidDate : today;
    const result = await computeMdFiling(salesTaxDue, dueDate, filedDate, paidDate);
    mdFiling = { ...result, dueDate, filedDate, paidDate };
  }

  return {
    sales, paychecks,
    salesTaxDue,
    grossSales: sum(sales, "gross_sales"),
    grossWages: sum(paychecks, "gross_wages"),
    employeeTaxes: sum(paychecks, "employee_taxes"),
    employerTaxes: sum(paychecks, "employer_taxes"),
    netPay: sum(paychecks, "net_pay"),
    totalPayrollCost: sum(paychecks, "total_cost"),
    adjustments: sum(sales, "adjustments"),
    byCategory: Array.from(byCategoryMap.entries()),
    lastPayment: sales.map((s) => s.payment_date).filter(Boolean).sort().slice(-1)[0] || null,
    federalWithholding: sum(paychecks, "federal_withholding"),
    socialSecurityEe: sum(paychecks, "social_security_ee"),
    socialSecurityEr: sum(paychecks, "social_security_er"),
    medicareEe: sum(paychecks, "medicare_ee"),
    medicareEr: sum(paychecks, "medicare_er"),
    stateTax: sum(paychecks, "state_tax"),
    suta: sum(paychecks, "suta"),
    importantDates,
    mdFiling,
  };
}

/**
 * Builds a real, computed period summary (sales tax + payroll figures) from this
 * client's actual v3_sales_input/v3_paychecks rows for the given date range — not a
 * static blurb. Powers the {{periodSummary}} token on the three "report" built-in
 * templates (Client Tax and Payroll Update, Sales Tax Summary, Payroll Summary) and
 * every SMS/WhatsApp send, which can only ever carry plain text. Sections are omitted
 * entirely when there's no data for that period, rather than printing an all-zeros
 * block.
 */
export async function computeClientPeriodSummary(clientId: string, periodStart: string, periodEnd: string, mdFiledDate?: string, mdPaidDate?: string): Promise<string> {
  const f = await fetchPeriodFigures(clientId, periodStart, periodEnd, mdFiledDate, mdPaidDate);
  const { sales, paychecks } = f;

  const lines: string[] = ["SUMMARY"];
  if (sales.length) lines.push(`Sales tax due: ${fmtMoney(f.salesTaxDue)}`);
  if (paychecks.length) {
    lines.push(`Payroll checks: ${paychecks.length}`);
    lines.push(`Payroll gross wages: ${fmtMoney(f.grossWages)}`);
    lines.push(`Net payroll paid: ${fmtMoney(f.netPay)}`);
    lines.push(`Payroll taxes: employee ${fmtMoney(f.employeeTaxes)} | employer ${fmtMoney(f.employerTaxes)}`);
  }
  if (!sales.length && !paychecks.length) lines.push("No sales or payroll activity recorded for this period.");

  if (sales.length) {
    lines.push("", "SALES TAX DETAIL");
    lines.push(`Gross sales: ${fmtMoney(f.grossSales)}`);
    for (const [categoryName, { taxable, tax }] of f.byCategory) {
      lines.push(`${categoryName}: ${fmtMoney(taxable)} taxable, ${fmtMoney(tax)} tax`);
    }
    lines.push(`Adjustments: ${fmtMoney(f.adjustments)}`);
    lines.push(`Sales tax due: ${fmtMoney(f.salesTaxDue)}`);
    if (f.lastPayment) lines.push(`Last recorded payment date: ${fmtDate(f.lastPayment)}`);
    if (f.mdFiling) {
      lines.push(`Return due date: ${fmtDate(f.mdFiling.dueDate)}`);
      if (f.mdFiling.onTime) {
        lines.push(`Timely discount: -${fmtMoney(f.mdFiling.discount)}`);
        lines.push(`Balance due: ${fmtMoney(f.mdFiling.balanceDue)}`);
      } else {
        lines.push(`Late penalty (10%): ${fmtMoney(f.mdFiling.penalty)}`);
        lines.push(`Interest (${f.mdFiling.monthsLate} mo): ${fmtMoney(f.mdFiling.interest)}`);
        lines.push(`Balance due: ${fmtMoney(f.mdFiling.balanceDue)}`);
      }
    }
  }

  if (paychecks.length) {
    lines.push("", "PAYROLL SUMMARY");
    lines.push(`Checks: ${paychecks.length}`);
    lines.push(`Gross wages: ${fmtMoney(f.grossWages)}`);
    lines.push(`Employee taxes: ${fmtMoney(f.employeeTaxes)}`);
    lines.push(`Employer taxes: ${fmtMoney(f.employerTaxes)}`);
    lines.push(`Net pay: ${fmtMoney(f.netPay)}`);
    lines.push(`Total payroll cost: ${fmtMoney(f.totalPayrollCost)}`);
    lines.push("", "PAYROLL TAX DETAIL");
    lines.push(`Federal withholding: ${fmtMoney(f.federalWithholding)}`);
    lines.push(`Social Security - employee: ${fmtMoney(f.socialSecurityEe)}`);
    lines.push(`Social Security - employer: ${fmtMoney(f.socialSecurityEr)}`);
    lines.push(`Medicare - employee: ${fmtMoney(f.medicareEe)}`);
    lines.push(`Medicare - employer: ${fmtMoney(f.medicareEr)}`);
    lines.push(`State withholding: ${fmtMoney(f.stateTax)}`);
    lines.push(`State unemployment (SUTA): ${fmtMoney(f.suta)}`);
  }

  if (f.importantDates.length) {
    lines.push("", "IMPORTANT DATES");
    for (const { label, date } of f.importantDates) lines.push(`${label} due date: ${fmtDate(date)}`);
  }

  return lines.join("\n");
}

export interface SummaryTableRow { label: string; labelAr: string; value: string }
export interface SummaryTableSection { title: string; titleAr: string; rows: SummaryTableRow[] }
export interface SummaryTable { sections: SummaryTableSection[]; hasData: boolean }

/**
 * Same figures as computeClientPeriodSummary, but as real structured bilingual
 * rows instead of a pre-formatted English string — powers the Reports "Client
 * Message" table and the Sales, Tax & Payroll report. Every label has a genuine
 * Arabic translation (the old plain-text version's "Arabic side" was actually just
 * the same English lines shown twice — this is what fixes that). Category names and
 * task-rule labels are free-text pulled from the database (categories staff define,
 * task types like "1120 Return") with no stored Arabic equivalent, so those two stay
 * as-is in both columns, same as the firm name staying English on the Arabic site.
 */
export async function computeClientPeriodSummaryTable(clientId: string, periodStart: string, periodEnd: string, mdFiledDate?: string, mdPaidDate?: string): Promise<SummaryTable> {
  const f = await fetchPeriodFigures(clientId, periodStart, periodEnd, mdFiledDate, mdPaidDate);
  const { sales, paychecks } = f;
  const sections: SummaryTableSection[] = [];
  const row = (label: string, labelAr: string, value: string): SummaryTableRow => ({ label, labelAr, value });

  const summaryRows: SummaryTableRow[] = [];
  if (sales.length) summaryRows.push(row("Sales tax due", "ضريبة المبيعات المستحقة", fmtMoney(f.salesTaxDue)));
  if (paychecks.length) {
    summaryRows.push(row("Payroll checks", "عدد شيكات الرواتب", String(paychecks.length)));
    summaryRows.push(row("Payroll gross wages", "إجمالي الأجور", fmtMoney(f.grossWages)));
    summaryRows.push(row("Net payroll paid", "صافي الرواتب المدفوعة", fmtMoney(f.netPay)));
    summaryRows.push(row("Payroll taxes — employee", "ضرائب الرواتب — الموظف", fmtMoney(f.employeeTaxes)));
    summaryRows.push(row("Payroll taxes — employer", "ضرائب الرواتب — صاحب العمل", fmtMoney(f.employerTaxes)));
  }
  if (!sales.length && !paychecks.length) {
    summaryRows.push(row("No sales or payroll activity recorded for this period.", "لا يوجد نشاط مبيعات أو رواتب مسجل لهذه الفترة.", ""));
  }
  sections.push({ title: "Summary", titleAr: "الملخص", rows: summaryRows });

  if (sales.length) {
    const rows: SummaryTableRow[] = [row("Gross sales", "إجمالي المبيعات", fmtMoney(f.grossSales))];
    for (const [categoryName, { taxable, tax }] of f.byCategory) {
      rows.push(row(categoryName, categoryName, `${fmtMoney(taxable)} taxable, ${fmtMoney(tax)} tax`));
    }
    rows.push(row("Adjustments", "التعديلات", fmtMoney(f.adjustments)));
    rows.push(row("Sales tax due", "ضريبة المبيعات المستحقة", fmtMoney(f.salesTaxDue)));
    if (f.lastPayment) rows.push(row("Last recorded payment date", "تاريخ آخر دفعة مسجلة", fmtDate(f.lastPayment)));
    if (f.mdFiling) {
      rows.push(row("Return due date", "تاريخ استحقاق الإقرار", fmtDate(f.mdFiling.dueDate)));
      if (f.mdFiling.onTime) {
        rows.push(row("Timely discount", "الخصم مقابل السداد في الموعد", `− ${fmtMoney(f.mdFiling.discount)}`));
        rows.push(row("Balance due", "الرصيد المستحق", fmtMoney(f.mdFiling.balanceDue)));
      } else {
        rows.push(row("Late penalty (10%)", "غرامة التأخير (10%)", fmtMoney(f.mdFiling.penalty)));
        rows.push(row(`Interest (${f.mdFiling.monthsLate} mo)`, `الفائدة (${f.mdFiling.monthsLate} شهر)`, fmtMoney(f.mdFiling.interest)));
        rows.push(row("Balance due", "الرصيد المستحق", fmtMoney(f.mdFiling.balanceDue)));
      }
    }
    sections.push({ title: "Sales Tax Detail", titleAr: "تفاصيل ضريبة المبيعات", rows });
  }

  if (paychecks.length) {
    sections.push({
      title: "Payroll Summary", titleAr: "ملخص الرواتب",
      rows: [
        row("Checks", "عدد الشيكات", String(paychecks.length)),
        row("Gross wages", "إجمالي الأجور", fmtMoney(f.grossWages)),
        row("Employee taxes", "ضرائب الموظف", fmtMoney(f.employeeTaxes)),
        row("Employer taxes", "ضرائب صاحب العمل", fmtMoney(f.employerTaxes)),
        row("Net pay", "صافي الراتب", fmtMoney(f.netPay)),
        row("Total payroll cost", "إجمالي تكلفة الرواتب", fmtMoney(f.totalPayrollCost)),
      ],
    });
    sections.push({
      title: "Payroll Tax Detail", titleAr: "تفاصيل ضرائب الرواتب",
      rows: [
        row("Federal withholding", "الضريبة الفيدرالية المقتطعة", fmtMoney(f.federalWithholding)),
        row("Social Security — employee", "الضمان الاجتماعي — الموظف", fmtMoney(f.socialSecurityEe)),
        row("Social Security — employer", "الضمان الاجتماعي — صاحب العمل", fmtMoney(f.socialSecurityEr)),
        row("Medicare — employee", "الرعاية الطبية (ميديكير) — الموظف", fmtMoney(f.medicareEe)),
        row("Medicare — employer", "الرعاية الطبية (ميديكير) — صاحب العمل", fmtMoney(f.medicareEr)),
        row("State withholding", "ضريبة الولاية المقتطعة", fmtMoney(f.stateTax)),
        row("State unemployment (SUTA)", "تأمين البطالة الحكومي (SUTA)", fmtMoney(f.suta)),
      ],
    });
  }

  if (f.importantDates.length) {
    sections.push({
      title: "Important Dates", titleAr: "تواريخ مهمة",
      rows: f.importantDates.map(({ label, date }) => row(`${label} due date`, `${label} — تاريخ الاستحقاق`, fmtDate(date))),
    });
  }

  return { sections, hasData: sales.length > 0 || paychecks.length > 0 };
}

/**
 * The Arabic-language counterpart to computeClientPeriodSummary — plain-text, for
 * the {{periodSummaryAr}} token in the Arabic side of the three "report" built-in
 * templates. Before this existed, the Arabic message body substituted the SAME
 * {{periodSummary}} token as the English body, so a client who set their language
 * preference to Arabic still received this section in English — only the greeting/
 * framing text around it was actually translated. Derived from
 * computeClientPeriodSummaryTable so the English and Arabic sends can never show
 * different numbers for the same period.
 */
export async function computeClientPeriodSummaryArabic(clientId: string, periodStart: string, periodEnd: string): Promise<string> {
  const { sections } = await computeClientPeriodSummaryTable(clientId, periodStart, periodEnd);
  const lines: string[] = [];
  for (const section of sections) {
    if (lines.length) lines.push("");
    lines.push(section.titleAr);
    for (const r of section.rows) lines.push(r.value ? `${r.labelAr}: ${r.value}` : r.labelAr);
  }
  return lines.join("\n");
}

export interface ResolvedTemplate {
  template_name: string; category: string | null;
  subject: string; message_english: string; message_arabic: string;
  active: boolean; source: "Custom override" | "Built-in default";
}

/**
 * Looks up a template by name and substitutes client/period placeholders —
 * shared by the GET /:templateName route below, reportsPdf.ts's Client
 * Message PDF, and reminders.routes.ts (which passes extraOverride for
 * task/document-specific tokens like {{taskName}}/{{itemsList}} that have
 * no client/period source), so all three read the exact same resolved text
 * rather than each re-deriving it independently and risking drift.
 */
// PERF-015 (Hard Audit, 2026-08-13) — reminders.routes.ts's staff-digest sweep
// calls resolveTemplate("Staff Task Reminder", ...) once per due task (could be
// dozens), and every one of those calls re-ran this exact same override lookup
// with the exact same args. Short TTL cache keyed by lowercased template name —
// a live template edit still takes effect within 30s, same tradeoff already
// accepted by ensureCoaTypeCache/getDashboardAlertSettings's caches.
const templateOverrideCache = new Map<string, { row: any; at: number }>();
const TEMPLATE_OVERRIDE_CACHE_TTL_MS = 30_000;

async function loadTemplateOverride(name: string): Promise<any> {
  const key = name.toLowerCase();
  const cached = templateOverrideCache.get(key);
  if (cached && Date.now() - cached.at < TEMPLATE_OVERRIDE_CACHE_TTL_MS) return cached.row;
  const row = await queryOne<any>(`SELECT * FROM altax.v3_templates WHERE lower(template_name) = lower($1)`, [name]);
  templateOverrideCache.set(key, { row, at: Date.now() });
  return row;
}

export async function resolveTemplate(
  name: string, clientId: string, periodStart: string, periodEnd: string,
  extraOverride?: Record<string, string>
): Promise<ResolvedTemplate | null> {
  const client = clientId ? await queryOne<any>(`SELECT client_id, client_name, email, phone FROM altax.v3_clients WHERE client_id = $1`, [clientId]) : null;

  const extra: Record<string, string> = {};
  if (clientId && periodStart && periodEnd) {
    extra.periodLabel = ` for ${fmtDate(periodStart)} - ${fmtDate(periodEnd)}`;
    extra.periodLabelAr = ` للفترة من ${fmtDate(periodStart)} إلى ${fmtDate(periodEnd)}`;
    extra.periodSummary = await computeClientPeriodSummary(clientId, periodStart, periodEnd);
    extra.periodSummaryAr = await computeClientPeriodSummaryArabic(clientId, periodStart, periodEnd);
  }
  Object.assign(extra, extraOverride);

  const override = await loadTemplateOverride(name);
  if (override) {
    return {
      template_name: override.template_name, category: override.category, active: override.active,
      subject: substitutePlaceholders(override.subject, client, extra),
      message_english: substitutePlaceholders(override.message_english, client, extra),
      message_arabic: substitutePlaceholders(override.message_arabic, client, extra),
      source: "Custom override",
    };
  }
  const builtIn = BUILT_IN.find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (!builtIn) return null;
  return {
    template_name: builtIn.name, category: builtIn.category, active: true,
    subject: substitutePlaceholders(builtIn.subject, client, extra),
    message_english: substitutePlaceholders(builtIn.english, client, extra),
    message_arabic: substitutePlaceholders(builtIn.arabic, client, extra),
    source: "Built-in default",
  };
}

/**
 * Real bilingual structured period figures for one client — powers the Reports
 * "Client Message" table and the Sales, Tax & Payroll report. Registered ahead of
 * the generic GET /:templateName below only for readability; there's no actual
 * routing collision since this path always has 2 segments (a client id after
 * "period-summary-table") and that one only ever matches 1.
 */
templatesRouter.get("/period-summary-table/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!periodStart || !periodEnd) return res.status(400).json({ error: "periodStart and periodEnd are required." });

  const mdFiledDate = String(req.query.mdFiledDate || "").trim() || undefined;
  const mdPaidDate = String(req.query.mdPaidDate || "").trim() || undefined;
  const table = await computeClientPeriodSummaryTable(clientId, periodStart, periodEnd, mdFiledDate, mdPaidDate);
  res.json({ clientName: client.client_name, periodStart, periodEnd, ...table });
}));

templatesRouter.get("/:templateName", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const name = req.params.templateName;
  const clientId = String(req.query.clientId || "").trim();
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();

  // Hard Audit finding, 2026-08-27: this merges in real client data (name/
  // email/phone, and with periodStart/periodEnd real sales-tax/payroll
  // figures) when clientId is set, same as /period-summary-table/:clientId
  // right above it — but was missing that route's canAccessClient check
  // entirely, letting a scoped staff user pull any client's financial data
  // just by passing a clientId they're not assigned to. clientId is
  // optional here (a raw template preview with no merge data is legitimate
  // with no client at all), so the check only applies when one is given.
  if (clientId && !(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }

  const resolved = await resolveTemplate(name, clientId, periodStart, periodEnd);
  if (!resolved) return res.status(404).json({ error: "Template not found." });
  const { source, ...template } = resolved;
  res.json({ template, source });
}));

/** Create/edit a template — ported from alTaxPortalSaveTemplate. Admin/staff. Upserts by template name so saving a built-in overrides it, matching legacy's "edit a built-in to override" behavior. */
templatesRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const templateName = String(body.templateName || "").trim();
  if (!templateName) return res.status(400).json({ error: "Template name is required." });

  const existing = await queryOne<any>(`SELECT template_id FROM altax.v3_templates WHERE lower(template_name) = lower($1)`, [templateName]);
  const templateId = existing?.template_id || `TPL-${Date.now()}`;

  const fields = {
    template_name: templateName, category: String(body.category || "Communications").trim(),
    subject: String(body.subject || "").trim(), message_english: String(body.messageEnglish || "").trim() || null,
    message_arabic: String(body.messageArabic || "").trim() || null,
    active: body.active === undefined ? true : Boolean(body.active), notes: String(body.notes || "").trim() || null,
  };

  if (existing) {
    await query(
      `UPDATE altax.v3_templates SET category=$2, subject=$3, message_english=$4, message_arabic=$5, active=$6,
         notes=$7, updated_at = now(), updated_by = $8
       WHERE template_id = $1`,
      [templateId, ...Object.values(fields), req.user!.email]
    );
    await logAudit("Templates", "EDIT", templateId, "", "", templateName, `Template edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_templates (template_id, template_name, category, subject, message_english, message_arabic, active, notes, updated_by, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Node Web App',$1)`,
      [templateId, ...Object.values(fields), req.user!.email]
    );
    await logAudit("Templates", "CREATE", templateId, "", "", templateName, `Template created by ${req.user!.email}.`, req.user!.email);
  }

  res.json({ ok: true, templateId });
}));
