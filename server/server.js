require("dotenv").config();
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const db = require("./db");
const { analyze } = require("./ai");
const { startScheduler } = require("./scheduler");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/analyze", async (req, res, next) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    const role = typeof req.body?.role === "string" ? req.body.role : "";
    if (!text) return res.status(400).json({ error: "Paste a notice to analyze." });
    if (text.length > 50000) return res.status(413).json({ error: "Notices must be 50,000 characters or fewer." });
    if (!["Student", "Employee", "Parent", "Customer"].includes(role)) {
      return res.status(400).json({ error: "Choose Student, Employee, Parent, or Customer." });
    }
    const hash = crypto.createHash("sha256").update(text).digest("hex");
    const cached = await db.getCachedAnalysis(hash, role);
    const result = cached || await db.saveAnalysis({ hash, text, role, analysis: await analyze(text, role) });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/tasks/:id", async (req, res, next) => {
  try {
    if (!["pending", "done"].includes(req.body?.status)) {
      return res.status(400).json({ error: "Task status must be pending or done." });
    }
    const task = await db.updateTask(req.params.id, req.body.status);
    if (!task) return res.status(404).json({ error: "Task not found." });
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(`Request failed: ${error.message}`);
  res.status(500).json({ error: "The request could not be completed. Please try again." });
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
