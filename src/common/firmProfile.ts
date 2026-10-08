/**
 * The firm's own editable identity (name/address/phone/email/logo) — shown on
 * generated PDFs (invoices, statements, reports), the reminder email header, and
 * the app's own branding (sidebar, login screen). Editable via Firm Settings
 * (admin-only, see firmSettings.routes.ts) — v3_firm_settings is the source of
 * truth once a row exists; DEFAULT_FIRM_PROFILE (the firm's real info, sourced
 * from their QuickBooks Online invoice) is only the fallback before the firm
 * has ever saved anything through that page.
 */
import { queryOne, query } from "../config/db";
import { composeAddress } from "./address";

export const DEFAULT_FIRM_PROFILE = {
  firmName: "AL Tax Service",
  street: "1714 St Paul St, 1A",
  city: "Baltimore",
  state: "MD",
  zipCode: "21202",
  phone: "4438258804",
  email: "altax70@gmail.com",
};

export interface FirmProfile {
  firmName: string;
  /** Structured fields — source of truth, edited via the Firm Settings form. */
  street: string;
  city: string;
  state: string;
  zipCode: string;
  /** Derived two-line display form, kept for PDF/email renderers that print a letterhead address. */
  addressLine1: string;
  addressLine2: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  /** A "Scan to pay" QR image from the firm's own bank/Zelle app — a static image, not a payment-processor integration, so it needs no API keys. Embedded on invoice PDFs when set. */
  zelleQrDataUrl: string | null;
  /** The phone number clients send Zelle payments to — printed as "Zelle by phone number: …" on every invoice (PDF, online page, email). */
  zellePhone: string;
  /** Firm credentials — print on engagement letters and prefill IRS 2848/8821 + MD 548 POA generation. Not PTIN/CAF: those are per-preparer, on v3_users. */
  ein: string;
  efin: string;
  website: string;
  /** Pre-fills a new invoice's Terms/Payment Instructions fields so staff don't retype them every time; still editable per invoice. */
  defaultPaymentTerms: string;
  defaultPaymentInstructions: string;
  /** Replaces the hardcoded "Thank you for your business." line at the bottom of every invoice PDF, when set. */
  invoiceFooter: string;
  /** Display name used on the From header of outbound email (the sending address itself stays whatever RESEND_FROM_EMAIL is verified for). */
  emailFromName: string;
  /** Overrides the reply-to address on outbound email — falls back to the firm's own contact email when unset. */
  emailReplyTo: string;
  /** A firm-wide closing line (e.g. "Warm regards, the AL Tax Service team") appended to every outbound email above the automatic contact-info footer. */
  emailSignature: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Convenience for PDF letterheads that want the two address lines as an array (previous FIRM_ADDRESS_LINES shape). */
export function addressLines(profile: Pick<FirmProfile, "addressLine1" | "addressLine2">): string[] {
  return [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim());
}

export async function getFirmProfile(): Promise<FirmProfile> {
  const row = await queryOne<any>(`SELECT * FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`);
  const street = row?.street_address ?? DEFAULT_FIRM_PROFILE.street;
  const city = row?.city ?? DEFAULT_FIRM_PROFILE.city;
  const state = row?.state ?? DEFAULT_FIRM_PROFILE.state;
  const zipCode = row?.zip_code ?? DEFAULT_FIRM_PROFILE.zipCode;
  const composed = composeAddress({ street, city, state, zip: zipCode });
  const [addressLine1, addressLine2] = (composed || "").split("\n");
  return {
    firmName: row?.firm_name || DEFAULT_FIRM_PROFILE.firmName,
    street, city, state, zipCode,
    addressLine1: addressLine1 || "",
    addressLine2: addressLine2 || "",
    phone: row?.phone || DEFAULT_FIRM_PROFILE.phone,
    email: row?.email || DEFAULT_FIRM_PROFILE.email,
    logoDataUrl: row?.logo_data && row?.logo_content_type ? `data:${row.logo_content_type};base64,${row.logo_data}` : null,
    zelleQrDataUrl: row?.zelle_qr_data && row?.zelle_qr_content_type ? `data:${row.zelle_qr_content_type};base64,${row.zelle_qr_data}` : null,
    zellePhone: row?.zelle_phone || "",
    ein: row?.ein || "",
    efin: row?.efin || "",
    website: row?.website || "",
    defaultPaymentTerms: row?.default_payment_terms || "",
    defaultPaymentInstructions: row?.default_payment_instructions || "",
    invoiceFooter: row?.invoice_footer || "",
    emailFromName: row?.email_from_name || "",
    emailReplyTo: row?.email_reply_to || "",
    emailSignature: row?.email_signature || "",
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

/** Raw logo bytes + content type for the public logo endpoint and PDF embedding — avoids round-tripping through a data URL. */
export async function getFirmLogo(): Promise<{ data: Buffer; contentType: string } | null> {
  const row = await queryOne<any>(`SELECT logo_data, logo_content_type FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`);
  if (!row?.logo_data || !row?.logo_content_type) return null;
  return { data: Buffer.from(row.logo_data, "base64"), contentType: row.logo_content_type };
}

/** Raw Zelle QR bytes + content type — same shape as getFirmLogo, for PDF embedding. */
export async function getFirmZelleQr(): Promise<{ data: Buffer; contentType: string } | null> {
  const row = await queryOne<any>(`SELECT zelle_qr_data, zelle_qr_content_type FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`);
  if (!row?.zelle_qr_data || !row?.zelle_qr_content_type) return null;
  return { data: Buffer.from(row.zelle_qr_data, "base64"), contentType: row.zelle_qr_content_type };
}

export async function updateFirmProfile(fields: {
  firmName?: string; street?: string; city?: string; state?: string; zipCode?: string; phone?: string; email?: string;
  logoData?: string | null; logoContentType?: string | null;
  zelleQrData?: string | null; zelleQrContentType?: string | null;
  ein?: string; efin?: string; website?: string;
  defaultPaymentTerms?: string; defaultPaymentInstructions?: string; invoiceFooter?: string;
  emailFromName?: string; emailReplyTo?: string; emailSignature?: string; zellePhone?: string;
  updatedBy: string;
}): Promise<void> {
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`);
  const merged = {
    firm_name: fields.firmName ?? existing?.firm_name ?? DEFAULT_FIRM_PROFILE.firmName,
    street_address: fields.street ?? existing?.street_address ?? DEFAULT_FIRM_PROFILE.street,
    city: fields.city ?? existing?.city ?? DEFAULT_FIRM_PROFILE.city,
    state: fields.state ?? existing?.state ?? DEFAULT_FIRM_PROFILE.state,
    zip_code: fields.zipCode ?? existing?.zip_code ?? DEFAULT_FIRM_PROFILE.zipCode,
    phone: fields.phone ?? existing?.phone ?? DEFAULT_FIRM_PROFILE.phone,
    email: fields.email ?? existing?.email ?? DEFAULT_FIRM_PROFILE.email,
    // logoData === null means "remove the logo" (explicit clear); undefined means "leave it as-is". Same convention for zelleQrData.
    logo_data: fields.logoData === undefined ? existing?.logo_data ?? null : fields.logoData,
    logo_content_type: fields.logoContentType === undefined ? existing?.logo_content_type ?? null : fields.logoContentType,
    zelle_qr_data: fields.zelleQrData === undefined ? existing?.zelle_qr_data ?? null : fields.zelleQrData,
    zelle_qr_content_type: fields.zelleQrContentType === undefined ? existing?.zelle_qr_content_type ?? null : fields.zelleQrContentType,
    ein: fields.ein ?? existing?.ein ?? null,
    efin: fields.efin ?? existing?.efin ?? null,
    website: fields.website ?? existing?.website ?? null,
    default_payment_terms: fields.defaultPaymentTerms ?? existing?.default_payment_terms ?? null,
    default_payment_instructions: fields.defaultPaymentInstructions ?? existing?.default_payment_instructions ?? null,
    invoice_footer: fields.invoiceFooter ?? existing?.invoice_footer ?? null,
    email_from_name: fields.emailFromName ?? existing?.email_from_name ?? null,
    email_reply_to: fields.emailReplyTo ?? existing?.email_reply_to ?? null,
    email_signature: fields.emailSignature ?? existing?.email_signature ?? null,
    zelle_phone: fields.zellePhone ?? existing?.zelle_phone ?? null,
  };
  await query(
    `INSERT INTO altax.v3_firm_settings (id, firm_name, street_address, city, state, zip_code, phone, email, logo_data, logo_content_type, zelle_qr_data, zelle_qr_content_type,
       ein, efin, website, default_payment_terms, default_payment_instructions, invoice_footer, email_from_name, email_reply_to, email_signature, zelle_phone, updated_at, updated_by)
     VALUES ('FIRM-1', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, now(), $22)
     ON CONFLICT (id) DO UPDATE SET
       firm_name = $1, street_address = $2, city = $3, state = $4, zip_code = $5, phone = $6, email = $7,
       logo_data = $8, logo_content_type = $9, zelle_qr_data = $10, zelle_qr_content_type = $11,
       ein = $12, efin = $13, website = $14, default_payment_terms = $15, default_payment_instructions = $16,
       invoice_footer = $17, email_from_name = $18, email_reply_to = $19, email_signature = $20, zelle_phone = $21,
       updated_at = now(), updated_by = $22`,
    [merged.firm_name, merged.street_address, merged.city, merged.state, merged.zip_code, merged.phone, merged.email,
      merged.logo_data, merged.logo_content_type, merged.zelle_qr_data, merged.zelle_qr_content_type,
      merged.ein, merged.efin, merged.website, merged.default_payment_terms, merged.default_payment_instructions,
      merged.invoice_footer, merged.email_from_name, merged.email_reply_to, merged.email_signature, merged.zelle_phone,
      fields.updatedBy]
  );
}
