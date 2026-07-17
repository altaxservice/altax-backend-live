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

export async function updateFirmProfile(fields: {
  firmName?: string; street?: string; city?: string; state?: string; zipCode?: string; phone?: string; email?: string;
  logoData?: string | null; logoContentType?: string | null; updatedBy: string;
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
    // logoData === null means "remove the logo" (explicit clear); undefined means "leave it as-is".
    logo_data: fields.logoData === undefined ? existing?.logo_data ?? null : fields.logoData,
    logo_content_type: fields.logoContentType === undefined ? existing?.logo_content_type ?? null : fields.logoContentType,
  };
  await query(
    `INSERT INTO altax.v3_firm_settings (id, firm_name, street_address, city, state, zip_code, phone, email, logo_data, logo_content_type, updated_at, updated_by)
     VALUES ('FIRM-1', $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
     ON CONFLICT (id) DO UPDATE SET
       firm_name = $1, street_address = $2, city = $3, state = $4, zip_code = $5, phone = $6, email = $7,
       logo_data = $8, logo_content_type = $9, updated_at = now(), updated_by = $10`,
    [merged.firm_name, merged.street_address, merged.city, merged.state, merged.zip_code, merged.phone, merged.email,
      merged.logo_data, merged.logo_content_type, fields.updatedBy]
  );
}
