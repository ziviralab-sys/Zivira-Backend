// src/utils/notify.ts
// Lightweight notification helper used by the Tour Plan void/reassign flow
// (PRD 12.1 — "Manager A not notified that their TP was voided").
//
// Two channels, both best-effort and non-blocking for the caller:
//  1. In-app: a targeted Notice document the Manager portal can poll/badge.
//  2. Email: sent via Resend if RESEND_API_KEY is configured in the
//     environment; otherwise this just logs, matching the same pattern
//     already used in jobs/manager-digest.job.ts.

import { NoticeModel } from "../models/notice.model.js";

// Plain best-effort email to an HR employee (onboarding document
// approved/rejected, credentials, etc.) — same Resend channel as
// notifyManager below, without the in-app Notice side-effect (the Notice
// model's audience enum is field-force specific and doesn't include a
// per-employee HR audience). Logs and returns quietly if RESEND_API_KEY
// isn't configured, so callers can always await this without special-casing
// "email isn't set up" in every route.
export async function notifyEmployeeEmail(params: {
  toEmail?: string | null;
  toName?: string | null;
  subject: string;
  message: string;
}) {
  const { toEmail, toName, subject, message } = params;
  if (!toEmail) {
    console.log(`[Notify] (no email on file) → ${toName ?? "employee"}: ${subject}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[Notify] (email skipped — no RESEND_API_KEY) → ${toName ?? ""} <${toEmail}>: ${subject} — ${message}`);
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "noreply@zivira-labs.com",
        to: toEmail,
        subject: `[Zivira HR] ${subject}`,
        text: `Hi ${toName ?? "there"},\n\n${message}\n\nLogin to the Zivira HR portal to view details.\n\nZivira Labs`
      })
    });
    if (!response.ok) {
      console.error("[Notify] Resend email failed:", response.status, await response.text());
    }
  } catch (err) {
    console.error("[Notify] Resend email error:", err);
  }
}

export async function notifyManager(params: {
  tenantSlug: string;
  managerEmployeeCode: string;
  managerEmail?: string | null;
  managerName?: string | null;
  title: string;
  message: string;
}) {
  const { tenantSlug, managerEmployeeCode, managerEmail, managerName, title, message } = params;

  try {
    await NoticeModel.create({
      tenantSlug,
      title,
      message,
      audience: "MANAGER",
      priority: "URGENT",
      postedBy: "system",
      targetEmployeeCode: managerEmployeeCode
    });
  } catch (err) {
    console.error("[Notify] Failed to create in-app notice:", err);
  }

  if (!managerEmail) return;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[Notify] (email skipped — no RESEND_API_KEY) → ${managerName ?? managerEmployeeCode} <${managerEmail}>: ${title} — ${message}`);
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL ?? "noreply@zivira-labs.com",
        to: managerEmail,
        subject: `[Zivira] ${title}`,
        text: `Hi ${managerName ?? managerEmployeeCode},\n\n${message}\n\nLogin at your Manager portal to view details.\n\nZivira Labs`
      })
    });
    if (!response.ok) {
      console.error("[Notify] Resend email failed:", response.status, await response.text());
    }
  } catch (err) {
    console.error("[Notify] Resend email error:", err);
  }
}
