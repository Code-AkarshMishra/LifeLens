require("dotenv").config();
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const db = require("./db");
const auth = require("./auth");
const { analyze } = require("./ai");
const mailer = require("./mailer");
const { createTaskIcs } = require("./calendar");
const { startScheduler } = require("./scheduler");

const app = express();
app.use(express.json({ limit: "12mb" }));

app.post("/auth-fallback", (req, res) => {
  req.resume();
  res.status(503).type("text/plain").send("LifeLens sign-in requires JavaScript. Enable JavaScript and reload the page.");
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

async function saveNoticeAnalysis(ownerId, text, role, analysis, contentHash) {
  const hash = contentHash || crypto.createHash("sha256").update(text).digest("hex");
  const cached = await db.getCachedAnalysis(ownerId, hash, role);
  return cached || db.saveAnalysis({ ownerId, hash, text, role, analysis });
}

const uploadMimeTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp",
  "text/plain", "text/markdown", "text/csv", "message/rfc822"
]);
const uploadExtensions = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".txt": "text/plain",
  ".md": "text/markdown", ".csv": "text/csv", ".eml": "message/rfc822"
};

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = auth.normalizeEmail(req.body?.email);
    const phone = auth.normalizePhone(req.body?.phone);
    const password = req.body?.password;
    if (name.length < 1 || name.length > 100) return res.status(400).json({ error: "Enter a name up to 100 characters." });
    if (!auth.isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!phone) return res.status(400).json({ error: "Enter an international phone number with country code, such as +91 96820 43203." });
    if (typeof password !== "string" || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be between 8 and 128 characters." });
    }
    const passwordFields = await auth.hashPassword(password);
    const created = await db.createUser({ name, email, phone, ...passwordFields });
    if (!created) return res.status(400).json({ error: "Could not create an account. Check your details and try again." });
    await auth.createLoginSession(req, res, created.userId);
    res.status(201).json({ user: created.user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = auth.normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const user = await db.findUserByEmail(email);
    const valid = typeof password === "string" && password.length <= 128 && await auth.verifyPassword(password, user);
    if (!valid) return res.status(401).json({ error: "Invalid email or password." });
    await auth.createLoginSession(req, res, user._id);
    res.json({ user: userProfile(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = auth.parseCookie(req.headers.cookie, auth.COOKIE_NAME);
    if (token) await db.deleteSession(auth.tokenDigest(token));
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/me", auth.authenticate, (req, res) => res.json({ user: req.user }));

app.get("/api/profile", auth.authenticate, (req, res) => {
  res.json({
    profile: {
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      emailReminders: req.user.emailReminders,
      whatsappReminders: req.user.whatsappReminders
    }
  });
});

app.patch("/api/profile", auth.authenticate, async (req, res, next) => {
  try {
    const preferences = {};
    for (const field of ["emailReminders", "whatsappReminders"]) {
      if (Object.hasOwn(req.body || {}, field)) {
        if (typeof req.body[field] !== "boolean") return res.status(400).json({ error: `${field} must be true or false.` });
        preferences[field] = req.body[field];
      }
    }
    if (preferences.whatsappReminders === true) {
      return res.status(400).json({ error: "WhatsApp is manual only. Open a task's WhatsApp link and review and send it in WhatsApp." });
    }
    if (!Object.keys(preferences).length) return res.status(400).json({ error: "Choose at least one reminder preference to update." });
    const user = await db.updateUserPreferences(req.userId, preferences);
    if (!user) return res.status(404).json({ error: "Profile not found." });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

function userProfile(user) {
  return {
    name: user.name, email: user.email, phone: user.phone,
    emailReminders: user.emailReminders,
    whatsappReminders: user.whatsappReminders
  };
}

app.post("/api/analyze", auth.authenticate, async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const role = typeof req.body?.role === "string" ? req.body.role : "";
    if (!text) return res.status(400).json({ error: "Paste a notice to analyze." });
    if (text.length > 50000) return res.status(413).json({ error: "Notices must be 50,000 characters or fewer." });
    if (!["Student", "Employee", "Parent", "Customer"].includes(role)) {
      return res.status(400).json({ error: "Choose Student, Employee, Parent, or Customer." });
    }
    const result = await saveNoticeAnalysis(req.userId, text, role, await analyze(text, role));
    const { ownerId, _id, ...safeResult } = result;
    res.json(safeResult);
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyze-file", auth.authenticate, async (req, res, next) => {
  try {
    const { name, mimeType, data, role } = req.body || {};
    if (typeof name !== "string" || typeof data !== "string" || !data
      || !["Student", "Employee", "Parent", "Customer"].includes(role)) {
      return res.status(400).json({ error: "Choose a file and reader role to continue." });
    }
    const safeName = path.basename(name).slice(0, 200);
    const extensionMime = uploadExtensions[path.extname(safeName).toLowerCase()];
    const normalizedMime = typeof mimeType === "string" && uploadMimeTypes.has(mimeType)
      ? mimeType
      : extensionMime;
    if (!normalizedMime || !uploadMimeTypes.has(normalizedMime)) {
      return res.status(415).json({ error: "Upload a PDF, PNG, JPG, WEBP, TXT, MD, CSV, or EML file." });
    }
    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0 || buffer.length > 8 * 1024 * 1024 || buffer.toString("base64") !== data) {
      return res.status(buffer.length > 8 * 1024 * 1024 ? 413 : 400).json({
        error: "Files must be a valid upload no larger than 8 MB."
      });
    }
    if (normalizedMime.startsWith("text/") || normalizedMime === "message/rfc822") {
      const text = buffer.toString("utf8").replace(/\0/g, "").trim();
      if (!text) return res.status(400).json({ error: "This text file is empty or could not be read." });
      if (text.length > 50000) return res.status(413).json({ error: "Text notices must be 50,000 characters or fewer." });
      const result = await saveNoticeAnalysis(req.userId, text, role, await analyze(text, role));
      const { ownerId, _id, ...safeResult } = result;
      return res.json({ ...safeResult, sourceName: safeName });
    }
    const contentHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const cached = await db.getCachedAnalysis(req.userId, contentHash, role);
    if (cached) {
      const { ownerId, _id, ...safeResult } = cached;
      return res.json({ ...safeResult, sourceName: safeName });
    }
    if (process.env.USE_AI !== "true" || !process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: "PDF and image uploads need Gemini. Set USE_AI=true and GEMINI_API_KEY, or upload a TXT/MD/EML file."
      });
    }
    let analysis;
    try {
      analysis = await require("./ai").analyzeFile(buffer, normalizedMime, role);
    } catch (error) {
      console.error(`Uploaded notice Gemini analysis failed: ${error.message}`);
      return res.status(error.status || 502).json({
        error: "Could not read this upload with Gemini. Check the API key or try a clearer file."
      });
    }
    const result = await saveNoticeAnalysis(req.userId, analysis.sourceText, role, analysis, contentHash);
    const { ownerId, _id, ...safeResult } = result;
    res.json({ ...safeResult, sourceName: safeName });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:id", auth.authenticate, async (req, res, next) => {
  try {
    if (!["pending", "done"].includes(req.body?.status)) {
      return res.status(400).json({ error: "Task status must be pending or done." });
    }
    const task = await db.updateTask(req.userId, req.params.id, req.body.status);
    if (!task) return res.status(404).json({ error: "Task not found." });
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

app.post("/api/tasks/:id/remind-email", auth.authenticate, async (req, res, next) => {
  try {
    const task = await db.findOwnedTask(req.userId, req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    if (task.status !== "pending") return res.status(409).json({ error: "Email reminders are only available for pending tasks." });
    if (task.owner.emailReminders !== true) {
      return res.status(403).json({ error: "Email reminders are turned off. Enable them in Reminder preferences first." });
    }
    if (!auth.isValidEmail(task.owner.email)) return res.status(422).json({ error: "Your account does not have a valid email address for reminders." });
    const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!subject || subject.length > 200 || /[\u0000-\u001F\u007F]/.test(subject)) {
      return res.status(400).json({ error: "Email subject must be 1–200 characters with no line breaks." });
    }
    if (!text || text.length > 100000 || /[\0]/.test(text) || /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
      return res.status(400).json({ error: "Email message must be 1–100,000 characters of plain text." });
    }
    const existing = task.reminders?.emailImmediate || {};
    if (existing.sentAt) return res.status(409).json({ error: "An immediate email reminder was already sent for this task." });
    if (!await db.claimImmediateEmail(req.userId, task.id)) {
      const latest = await db.findOwnedTask(req.userId, task.id);
      if (latest?.reminders?.emailImmediate?.sentAt) {
        return res.status(409).json({ error: "An immediate email reminder was already sent for this task." });
      }
      return res.status(409).json({ error: "An immediate email reminder is already being sent for this task. Please wait." });
    }
    const claimedTask = await db.findOwnedTask(req.userId, task.id);
    if (!claimedTask || claimedTask.owner.emailReminders !== true) {
      await db.markImmediateEmail(req.userId, task.id, {
        status: "opted_out", attemptedAt: new Date().toISOString()
      });
      return res.status(403).json({ error: "Email reminders are turned off. Enable them in Reminder preferences first." });
    }
    const missing = mailer.missingSmtpSettings();
    if (missing.length) {
      await db.markImmediateEmail(req.userId, task.id, {
        status: "not_configured", attemptedAt: new Date().toISOString()
      });
      return res.status(503).json({ error: mailer.smtpConfigurationMessage(missing) });
    }

    let sent;
    try {
      sent = await mailer.sendReminder(task, claimedTask.owner, { subject, text });
    } catch (error) {
      await db.markImmediateEmail(req.userId, task.id, {
        status: "error", attemptedAt: new Date().toISOString(), lastError: error.message
      });
      console.error(`Failed to send immediate email reminder for task ${task.id}: ${error.message}`);
      return res.status(502).json({ error: "SMTP could not send this email. Check your SMTP settings and provider status, then try again." });
    }
    if (!sent) {
      await db.markImmediateEmail(req.userId, task.id, {
        status: "not_configured", attemptedAt: new Date().toISOString()
      });
      return res.status(503).json({ error: mailer.smtpConfigurationMessage() });
    }
    const sentAt = new Date().toISOString();
    await db.markImmediateEmail(req.userId, task.id, { status: "sent", attemptedAt: sentAt, sentAt });
    return res.json({ accepted: true, message: `SMTP accepted the email for delivery to ${claimedTask.owner.email}.` });
  } catch (error) {
    next(error);
  }
});

app.get("/api/tasks/:id/calendar.ics", auth.authenticate, async (req, res, next) => {
  try {
    const task = await db.findOwnedTask(req.userId, req.params.id);
    if (!task) return res.status(404).json({ error: "Task not found." });
    if (!task.deadline) return res.status(400).json({ error: "This task has no parsed deadline to add to a calendar." });
    const ics = createTaskIcs(task);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="lifelens-task-reminder.ics"');
    res.send(ics);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error.status === 401) return res.status(401).json({ error: "Please sign in to continue." });
  console.error(`Request failed: ${error.message}`);
  res.status(error.status === 413 ? 413 : 500).json({
    error: error.status === 413 ? "Request body is too large." : "The request could not be completed. Please try again."
  });
});

async function start() {
  await db.connect();
  startScheduler();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.info(`LifeLens is running at http://localhost:${port}`));
}

if (require.main === module) {
  start().catch((error) => {
    console.error(`LifeLens failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = app;
