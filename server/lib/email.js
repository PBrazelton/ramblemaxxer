/**
 * server/lib/email.js
 * Postmark email client. Logs to console when no API key is set (safe for local dev).
 */

const postmark = require("postmark");

const API_KEY = process.env.POSTMARK_API_KEY;
const FROM = process.env.POSTMARK_FROM || "noreply@ramblemaxxer.com";
const APP_URL = process.env.APP_URL || "http://localhost:5175";

let client = null;
if (API_KEY) {
  client = new postmark.ServerClient(API_KEY);
}

async function send(to, subject, htmlBody) {
  if (!client) {
    console.log(`[email] (no Postmark key — logging instead)`);
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${htmlBody}`);
    return;
  }
  await client.sendEmail({ From: FROM, To: to, Subject: subject, HtmlBody: htmlBody });
}

async function sendInviteEmail(to, inviteUrl, inviterName) {
  const subject = `${inviterName} invited you to Ramblemaxxer`;
  const html = `
    <p>Hey! <strong>${inviterName}</strong> invited you to <strong>Ramblemaxxer</strong>,
    a schedule optimizer for LUC students.</p>
    <p><a href="${inviteUrl}">Create your account &rarr;</a></p>
    <p style="color:#888;font-size:12px">This invite expires in 7 days.</p>
  `;
  await send(to, subject, html);
}

async function sendPasswordResetEmail(to, token) {
  const resetUrl = `${APP_URL}/#/reset-password?token=${token}`;
  const subject = "Reset your Ramblemaxxer password";
  const html = `
    <p>Someone requested a password reset for your Ramblemaxxer account.</p>
    <p><a href="${resetUrl}">Reset password &rarr;</a></p>
    <p style="color:#888;font-size:12px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
  `;
  await send(to, subject, html);
}

module.exports = { sendInviteEmail, sendPasswordResetEmail };
