process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const db = require("../server/db");
const { sendDueReminders } = require("../server/scheduler");
const app = require("../server/server");

let server;
let baseUrl;

before(async () => {
  await db.connect();
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(route, { method = "GET", body, cookie } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const rawCookie = response.headers.get("set-cookie");
  const result = await response.json();
  return {
    response,
    result,
    cookie: rawCookie ? rawCookie.split(";")[0] : cookie
  };
}

test("authentication, session restoration, task access and account separation", async () => {
  const blockedAnalyze = await request("/api/analyze", {
    method: "POST", body: { text: "Submit the form by October 15, 2026.", role: "Student" }
  });
  assert.equal(blockedAnalyze.response.status, 401);
  const blockedUpdate = await request("/api/tasks/not-a-task", {
    method: "PATCH", body: { status: "done" }
  });
  assert.equal(blockedUpdate.response.status, 401);

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Ada Example", email: " ADA@example.com ", phone: "+14155550101",
      password: "a-secure-passphrase"
    }
  });
  assert.equal(registration.response.status, 201);
  assert.match(registration.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(registration.response.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal(registration.result.user.email, "ada@example.com");
  assert.equal(registration.result.user.emailReminders, true);
  assert.equal(registration.result.user.whatsappReminders, false);
  assert.doesNotMatch(JSON.stringify(registration.result), /passwordHash|passwordSalt|tokenHash/);
  const storedUser = await db.findUserByEmail("ada@example.com");
  assert.notEqual(storedUser.passwordHash, "a-secure-passphrase");
  assert.equal(storedUser.passwordHash.length, 128);

  const duplicate = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Another Ada", email: "ada@example.com", phone: "+14155550102",
      password: "a-secure-passphrase"
    }
  });
  assert.equal(duplicate.response.status, 400);

  const duplicateRace = await Promise.all(["RACE@example.com", "race@example.com"].map((email, index) =>
    request("/api/auth/register", {
      method: "POST",
      body: {
        name: `Race ${index}`, email, phone: `+1415555010${4 + index}`,
        password: "a-race-secure-passphrase"
      }
    })
  ));
  assert.deepEqual(duplicateRace.map(({ response }) => response.status).sort(), [201, 400]);

  const restored = await request("/api/auth/me", { cookie: registration.cookie });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.result.user.name, "Ada Example");
  assert.doesNotMatch(JSON.stringify(restored.result), /passwordHash|passwordSalt|tokenHash/);

  const notice = "Please submit your signed registration form by October 15, 2026.";
  const firstAnalysis = await request("/api/analyze", {
    method: "POST", cookie: registration.cookie,
    body: { text: notice, role: "Student" }
  });
  assert.equal(firstAnalysis.response.status, 200);
  assert.equal(firstAnalysis.result.cached, false);
  assert.equal(firstAnalysis.result.tasks.length, 1);

  const reloadAnalysis = await request("/api/analyze", {
    method: "POST", cookie: registration.cookie,
    body: { text: notice, role: "Student" }
  });
  assert.equal(reloadAnalysis.result.cached, true);
  assert.equal(reloadAnalysis.result.tasks[0].id, firstAnalysis.result.tasks[0].id);
  const concurrentNotice = "Please submit the unique form by October 16, 2026.";
  const concurrentAnalyses = await Promise.all([1, 2].map(() => request("/api/analyze", {
    method: "POST", cookie: registration.cookie,
    body: { text: concurrentNotice, role: "Student" }
  })));
  assert.equal(concurrentAnalyses[0].result.tasks[0].id, concurrentAnalyses[1].result.tasks[0].id);

  const failedLogin = await request("/api/auth/login", {
    method: "POST", body: { email: "ada@example.com", password: "incorrect-password" }
  });
  const unknownLogin = await request("/api/auth/login", {
    method: "POST", body: { email: "nobody@example.com", password: "incorrect-password" }
  });
  assert.equal(failedLogin.response.status, 401);
  assert.equal(failedLogin.result.error, unknownLogin.result.error);

  const relogin = await request("/api/auth/login", {
    method: "POST", cookie: registration.cookie,
    body: { email: "ADA@example.com", password: "a-secure-passphrase" }
  });
  assert.equal(relogin.response.status, 200);
  assert.notEqual(relogin.cookie, registration.cookie);
  assert.equal((await request("/api/auth/me", { cookie: registration.cookie })).response.status, 401);

  const secondAccount = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Grace Example", email: "grace@example.com", phone: "+14155550103",
      password: "another-secure-passphrase"
    }
  });
  const secondAnalysis = await request("/api/analyze", {
    method: "POST", cookie: secondAccount.cookie,
    body: { text: notice, role: "Student" }
  });
  assert.equal(secondAnalysis.result.cached, false);
  assert.notEqual(secondAnalysis.result.tasks[0].id, firstAnalysis.result.tasks[0].id);

  const crossAccountUpdate = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}`, {
    method: "PATCH", cookie: secondAccount.cookie, body: { status: "done" }
  });
  assert.equal(crossAccountUpdate.response.status, 404);
  const ownedUpdate = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}`, {
    method: "PATCH", cookie: relogin.cookie, body: { status: "done" }
  });
  assert.equal(ownedUpdate.response.status, 200);
  assert.equal(ownedUpdate.result.task.status, "done");

  const preferences = await request("/api/profile", {
    method: "PATCH", cookie: relogin.cookie,
    body: { emailReminders: false, whatsappReminders: true }
  });
  assert.equal(preferences.response.status, 200);
  assert.equal(preferences.result.user.emailReminders, false);
  assert.equal(preferences.result.user.whatsappReminders, true);

  const firstUser = await db.findUserByEmail("ada@example.com");
  const unverifiedHash = "unverified-whatsapp-test";
  await db.saveAnalysis({
    ownerId: firstUser._id, hash: unverifiedHash, text: "unverified whatsapp test", role: "Student",
    analysis: {
      summary: "Reminder test",
      actions: [{
        action: "Complete unverified test task", evidence: "Complete unverified test task.",
        deadline: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
        deadlineText: "yesterday", priority: "Normal", consequence: "None"
      }]
    }
  });
  const secondUser = await db.findUserByEmail("grace@example.com");
  const dueHash = "reminder-status-test";
  await db.saveAnalysis({
    ownerId: secondUser._id, hash: dueHash, text: "test reminder", role: "Student",
    analysis: {
      summary: "Reminder test",
      actions: [{
        action: "Complete test task", evidence: "Complete test task.",
        deadline: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
        deadlineText: "yesterday", priority: "Normal", consequence: "None"
      }]
    }
  });
  for (const key of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]) {
    delete process.env[key];
  }
  await sendDueReminders();
  const reminderResult = await db.getCachedAnalysis(secondUser._id, dueHash, "Student");
  assert.equal(reminderResult.tasks[0].reminders.email.status, "not_configured");
  assert.equal(reminderResult.tasks[0].reminders.whatsapp.status, "opted_out");
  const unverifiedResult = await db.getCachedAnalysis(firstUser._id, unverifiedHash, "Student");
  assert.equal(unverifiedResult.tasks[0].reminders.email.status, "opted_out");
  assert.equal(unverifiedResult.tasks[0].reminders.whatsapp.status, "phone_unverified");

  const logout = await request("/api/auth/logout", { method: "POST", cookie: relogin.cookie });
  assert.equal(logout.response.status, 200);
  const afterLogout = await request("/api/auth/me", { cookie: logout.cookie });
  assert.equal(afterLogout.response.status, 401);
});
