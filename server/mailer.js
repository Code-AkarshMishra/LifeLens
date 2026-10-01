const nodemailer = require("nodemailer");

async function sendReminder(task, user) {
  if (!process.env.SMTP_HOST || !user?.email) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transporter.sendMail({
    from,
    to: user.email,
    subject: `LifeLens reminder: ${task.action}`,
    text: `Reminder: ${task.action}\nDeadline: ${task.deadline || "See notice"}\n\nEvidence: "${task.evidence}"`
  });
  return true;
}

module.exports = { sendReminder };
