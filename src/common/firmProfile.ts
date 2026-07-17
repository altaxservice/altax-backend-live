/**
 * AL Tax Service's own letterhead identity — real business info (address/phone/email),
 * shown on generated PDFs (invoices, statements). Not editable via the UI yet; if that
 * becomes necessary, promote this to a settings table. Sourced from the firm's real
 * QuickBooks Online invoice at the user's request when rebuilding invoicePdf.ts to
 * match QBO's letterhead layout.
 */
export const FIRM_NAME = "AL Tax Service";
export const FIRM_ADDRESS_LINES = ["1714 St Paul St, 1A", "Baltimore, MD 21202 US"];
export const FIRM_PHONE = "4438258804";
export const FIRM_EMAIL = "altax70@gmail.com";
