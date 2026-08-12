import type { Request } from "express";
import { APP_NAME, COPYRIGHT } from "./branding";
import { getFirmProfile } from "./firmProfile";
import { publicBaseUrl } from "./publicUrl";

/**
 * Branded wrapper for outbound emails — header with the app name (+ logo, if the
 * firm has uploaded one via Firm Settings), the caller's own body content
 * untouched in the middle, footer with firm contact info + copyright. `bodyHtml`
 * is trusted HTML from the caller (already escaped/converted upstream, e.g.
 * reminders.routes.ts's plain-text-to-<br> conversion) — this only adds the
 * shell around it, it doesn't sanitize.
 *
 * The logo is linked via the public /firm-settings/logo endpoint rather than
 * embedded as a base64 data URI — a real uploaded logo easily runs 200-300KB,
 * which inflates ~33% larger as base64 and pushes the whole email past Gmail's
 * ~102KB clip threshold. A clipped email with no visible content behind "View
 * entire message" reads as a phishing attempt to a client opening it on their
 * phone. Referencing the logo by URL keeps every email a few KB regardless of
 * logo size. `req` lets the URL resolve to whichever host actually received
 * the request; omit it only where no request exists (the cron digest).
 */
export async function wrapEmailHtml(bodyHtml: string, req?: Request): Promise<string> {
  const profile = await getFirmProfile();
  const addressLine = [profile.addressLine1, profile.addressLine2].filter((l) => l && l.trim()).join(", ");
  const base = publicBaseUrl(req);
  // A localhost base (dev-sent test emails) is unreachable from the recipient's
  // mail client, so the <img> would render as a broken-image icon in the header —
  // worse than no logo. Skip it and let the text-only header stand in; production
  // requests carry a public host and get the real logo.
  const publiclyReachable = base && !/localhost|127\.0\.0\.1/i.test(base);
  const logoImg = profile.logoDataUrl && publiclyReachable
    ? `<img src="${base}/firm-settings/logo" alt="${profile.firmName}" style="height:28px; display:block; margin-bottom:4px;">`
    : "";

  return `<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background:#f4f5f7; font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7; padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:8px; overflow:hidden; max-width:600px; width:100%;">
            <tr>
              <td style="background:#0f2d3e; padding:20px 28px;">
                ${logoImg}
                <span style="color:#ffffff; font-size:18px; font-weight:700; letter-spacing:0.02em;">${APP_NAME}</span>
                <div style="color:#9fb4bf; font-size:12px; margin-top:2px;">${profile.firmName}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px; color:#1a1a1a; font-size:14px; line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px; border-top:1px solid #e5e7eb; color:#6b7280; font-size:11.5px; line-height:1.6;">
                ${profile.firmName}${addressLine ? " — " + addressLine : ""}<br>
                ${profile.phone ? `Phone: ${profile.phone}` : ""}${profile.phone && profile.email ? " · " : ""}${profile.email ? `Email: ${profile.email}` : ""}<br>
                ${COPYRIGHT}<br>
                This is an automated message from ${APP_NAME}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * The portal-invite email body — previously duplicated near-verbatim in
 * users.routes.ts (sendInviteEmail) and portalUserProvisioning.ts
 * (provisionEmployeePortalUser's inline invite send), each with its own
 * English-only copy the comments explicitly flagged as "kept in sync
 * manually." One shared, bilingual version instead. Used for every portal
 * role (admin/staff/employee/client invites all reuse this), so the wording
 * stays generic rather than naming a specific role.
 */
export function portalInviteEmailHtml(name: string, link: string): string {
  const greetingName = name ? name : "";
  return `<div dir="ltr" style="text-align:left;">
  <p>${greetingName ? `Hi ${greetingName},` : "Hello,"}</p>
  <p>You've been invited to the AL TAX SERVICE portal, where you can access your documents, invoices, and messages anytime.</p>
  <p>Click the link below to set up your account:</p>
  <p><a href="${link}">${link}</a></p>
  <p>This link expires in 7 days.</p>
</div>
<hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;">
<div dir="rtl" style="text-align:right;">
  <p>${greetingName ? `مرحباً ${greetingName}،` : "مرحباً،"}</p>
  <p>تمت دعوتكم للانضمام إلى بوابة AL TAX SERVICE، حيث يمكنكم الوصول إلى مستنداتكم وفواتيركم ورسائلكم في أي وقت.</p>
  <p>يرجى الضغط على الرابط أدناه لإعداد حسابكم:</p>
  <p><bdi dir="ltr"><a href="${link}">${link}</a></bdi></p>
  <p>ينتهي هذا الرابط خلال 7 أيام.</p>
</div>`;
}
