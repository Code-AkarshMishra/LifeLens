const nodemailer = require("nodemailer");

async function sendReminder(task) {
  if (!process.env.REMINDER_EMAIL || !process.env.SMTP_HOST) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transporter.sendMail({
    from: process.env.SMTP_USER || process.env.REMINDER_EMAIL,
    to: process.env.REMINDER_EMAIL,
    subject: `LifeLens reminder: ${task.action}`,
    text: `Reminder: ${task.action}\nDeadline: ${task.deadline || "See notice"}\n\nEvidence: "${task.evidence}"`
  });
  return true;
}

module.exports = { sendReminder };
