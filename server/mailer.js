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

function reminderMessage(task) {
  const actionMatchesEvidence = task.action === task.evidence;
  const separateConsequenceEvidence = task.consequenceEvidence
    && task.consequenceEvidence !== task.evidence
    && task.consequenceEvidence !== task.action;
  return {
    subject: `LifeLens reminder: ${task.action}`.slice(0, 200),
    text: [
      `${actionMatchesEvidence ? "Action (exact sentence from your notice)" : "Action"}: ${task.action}`,
      `Deadline: ${task.deadline ? `${task.deadlineText || task.deadline} (${task.deadline})` : "No deadline specified in the notice"}`,
      `Priority: ${task.priority || "Normal"}`,
      `${separateConsequenceEvidence ? "If missed (exact related sentence from your notice)" : "If missed"}: ${separateConsequenceEvidence ? task.consequenceEvidence : (task.consequence || "No consequence is explicitly stated in this notice.")}`,
      ...(!actionMatchesEvidence ? ["", "Exact sentence from your notice:", task.evidence || ""] : [])
    ].join("\n")
  };
}

async function sendReminder(task, user, message, createTransport = nodemailer.createTransport) {
  if (missingSmtpSettings().length || !user?.email) return false;
  message = message || reminderMessage(task);
  if (typeof message.subject !== "string" || typeof message.text !== "string") throw new Error("A subject and plain-text email body are required.");
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
    subject: message.subject,
    text: message.text
  });
  return true;
}

module.exports = { sendReminder, reminderMessage, missingSmtpSettings, smtpConfigurationMessage };
