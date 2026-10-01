const nodemailer = require("nodemailer");

function missingSmtpSettings() {
  const missing = [];
  const configured = (name) => typeof process.env[name] === "string" && process.env[name].trim().length > 0;
  if (!configured("SMTP_HOST")) missing.push("SMTP_HOST");
  if (!configured("SMTP_FROM") && !configured("SMTP_USER")) missing.push("SMTP_FROM or SMTP_USER");
  if (configured("SMTP_USER") && !configured("SMTP_PASS")) missing.push("SMTP_PASS");
  return missing;
}

function smtpConfigurationMessage(missing = missingSmtpSettings()) {
  return `Email reminders are not configured. Set ${missing.join(" and ")} in the deployment environment.`;
}

async function sendReminder(task, user, createTransport = nodemailer.createTransport) {
  if (missingSmtpSettings().length || !user?.email) return false;
  const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER?.trim();
  const transporter = createTransport({
    host: process.env.SMTP_HOST.trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER?.trim()
      ? { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS }
      : undefined
  });
  await transporter.sendMail({
    from,
    to: user.email,
    subject: `LifeLens reminder: ${task.action}`,
    text: `Reminder: ${task.action}\nDeadline: ${task.deadline || "See notice"}\n\nEvidence: "${task.evidence}"`
  });
  return true;
}

module.exports = { sendReminder, missingSmtpSettings, smtpConfigurationMessage };
