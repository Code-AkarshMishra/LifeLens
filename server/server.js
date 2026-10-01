require("dotenv").config();
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const db = require("./db");
const auth = require("./auth");
const { analyze } = require("./ai");
const { startScheduler } = require("./scheduler");
const phoneVerification = require("./phone-verification");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = auth.normalizeEmail(req.body?.email);
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const password = req.body?.password;
    if (name.length < 1 || name.length > 100) return res.status(400).json({ error: "Enter a name up to 100 characters." });
    if (!auth.isValidEmail(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return res.status(400).json({ error: "Enter a phone number in E.164 format, such as +14155552671." });
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
      phoneVerified: req.user.phoneVerified,
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
    if (preferences.whatsappReminders === true && !req.user.phoneVerified) {
      return res.status(400).json({ error: "Verify your phone before opting in to WhatsApp reminders." });
    }
    if (!Object.keys(preferences).length) return res.status(400).json({ error: "Choose at least one reminder preference to update." });
    const user = await db.updateUserPreferences(req.userId, preferences);
    if (!user) return res.status(404).json({ error: "Profile not found." });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/profile/phone-verification/send-code", auth.authenticate, async (req, res, next) => {
  try {
    if (req.body?.smsConsent !== true) {
      return res.status(400).json({ error: "Consent to receive a one-time verification SMS before requesting a code." });
    }
    if (!phoneVerification.isConfigured()) {
      return res.status(503).json({ error: "Phone verification is unavailable. Configure Twilio Verify credentials first." });
    }
    if (req.user.phoneVerified) return res.status(409).json({ error: "This phone number is already verified." });
    const claim = await db.claimPhoneVerification(req.userId, req.user.phone);
    if (claim === "verified") return res.status(409).json({ error: "This phone number is already verified." });
    if (claim === "rate_limited") {
      return res.status(429).json({ error: "A code was requested recently. Wait at least 60 seconds before requesting another." });
    }
    if (claim !== "claimed") return res.status(404).json({ error: "Profile not found." });
    try {
      await phoneVerification.sendCode(req.user.phone);
    } catch (error) {
      if (error.status === 429) {
        return res.status(429).json({ error: "Twilio Verify rate limit reached. Wait before requesting another code." });
      }
      console.error(`Twilio Verify could not send a code (HTTP ${error.status || "network error"}).`);
      return res.status(502).json({ error: "Twilio Verify could not send the code. Check the Verify service and SMS configuration." });
    }
    res.json({ sent: true, message: `A verification code was sent to ${req.user.phone}.` });
  } catch (error) {
    next(error);
  }
});

app.post("/api/profile/phone-verification/verify-code", auth.authenticate, async (req, res, next) => {
  try {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!/^\d{4,10}$/.test(code)) return res.status(400).json({ error: "Enter the numeric verification code from the SMS." });
    if (!phoneVerification.isConfigured()) {
      return res.status(503).json({ error: "Phone verification is unavailable. Configure Twilio Verify credentials first." });
    }
    if (req.user.phoneVerified) return res.json({ user: userProfile({ ...req.user, phoneVerified: true }) });
    let verification;
    try {
      verification = await phoneVerification.checkCode(req.user.phone, code);
    } catch (error) {
      if (error.status === 429) {
        return res.status(429).json({ error: "Twilio Verify rate limit reached. Wait before trying again." });
      }
      if (error.status === 404) return res.status(400).json({ error: "That code is invalid or expired. Request a new code and try again." });
      console.error(`Twilio Verify could not check a code (HTTP ${error.status || "network error"}).`);
      return res.status(502).json({ error: "Twilio Verify could not check the code. Please try again." });
    }
    if (verification.status !== "approved") {
      return res.status(400).json({ error: "That code is invalid or expired. Request a new code and try again." });
    }
    const user = await db.markPhoneVerified(req.userId, req.user.phone);
    if (!user) return res.status(409).json({ error: "The account phone number changed. Request a new code for the current number." });
    res.json({ user: userProfile(user), verified: true });
  } catch (error) {
    next(error);
  }
});

function userProfile(user) {
  return {
    name: user.name, email: user.email, phone: user.phone,
    phoneVerified: user.phoneVerified, emailReminders: user.emailReminders,
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
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const cached = await db.getCachedAnalysis(req.userId, hash, role);
    const result = cached || await db.saveAnalysis({
      ownerId: req.userId,
      hash, text, role, analysis: await analyze(text, role)
    });
    const { ownerId, _id, ...safeResult } = result;
    res.json(safeResult);
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
