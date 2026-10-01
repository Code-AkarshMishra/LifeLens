process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");
const db = require("../server/db");
const mailer = require("../server/mailer");
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
  if (route.endsWith("/remind-email") && body === undefined) {
    body = { subject: "Test reminder", text: "Test reminder message." };
  }
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const rawCookie = response.headers.get("set-cookie");
  const result = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : await response.text();
  return {
    response,
    result,
    cookie: rawCookie ? rawCookie.split(";")[0] : cookie
  };
}

test("authentication, session restoration, task access and account separation", async () => {
  const pageResponse = await fetch(`${baseUrl}/`);
  const page = await pageResponse.text();
  assert.equal(pageResponse.status, 200);
  assert.doesNotMatch(page, /phone-verification|verification-code|sms-consent/);
  assert.match(page, /reminder-links\.js/);
  assert.match(page, /Grounded, not guessed/);
  assert.match(page, /Try the sample plan/);
  assert.match(page, /GEMINI_API_KEY/);
  assert.match(page, /id="notice-file"/);
  assert.match(await (await fetch(`${baseUrl}/app.js`)).text(), /All steps complete/);
  assert.match(await (await fetch(`${baseUrl}/reminder-links.js`)).text(), /https:\/\/wa\.me/);
  assert.match(await (await fetch(`${baseUrl}/app.js`)).text(), /whatsapp-message/);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/health`)).json(), { ok: true });

  const blockedAnalyze = await request("/api/analyze", {
    method: "POST", body: { text: "Submit the form by October 15, 2026.", role: "Student" }
  });
  assert.equal(blockedAnalyze.response.status, 401);
  const blockedUpdate = await request("/api/tasks/not-a-task", {
    method: "PATCH", body: { status: "done" }
  });
  assert.equal(blockedUpdate.response.status, 401);
  const blockedEmail = await request("/api/tasks/not-a-task/remind-email", { method: "POST" });
  assert.equal(blockedEmail.response.status, 401);
  const blockedCalendar = await request("/api/tasks/not-a-task/calendar.ics");
  assert.equal(blockedCalendar.response.status, 401);
  const blockedUpload = await request("/api/analyze-file", {
    method: "POST", body: { name: "notice.pdf", mimeType: "application/pdf", data: "JVBERg==", role: "Student" }
  });
  assert.equal(blockedUpload.response.status, 401);

  for (const [index, phone] of ["9682043203", "+91 9682", "+91 96820 43A03", "++91 96820 43203"].entries()) {
    const invalidRegistration = await request("/api/auth/register", {
      method: "POST",
      body: {
        name: "Invalid Phone", email: `invalid-phone-${index}@example.com`, phone,
        password: "a-secure-passphrase"
      }
    });
    assert.equal(invalidRegistration.response.status, 400, `Expected ${phone} to be rejected`);
  }

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "Ada Example", email: " ADA@example.com ", phone: "+91 9682043203",
      password: "a-secure-passphrase"
    }
  });
  assert.equal(registration.response.status, 201);
  assert.match(registration.response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(registration.response.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal(registration.result.user.email, "ada@example.com");
  assert.equal(registration.result.user.phone, "+919682043203");
  assert.equal(registration.result.user.emailReminders, true);
  assert.equal(registration.result.user.whatsappReminders, false);
  assert.doesNotMatch(JSON.stringify(registration.result), /passwordHash|passwordSalt|tokenHash/);
  const storedUser = await db.findUserByEmail("ada@example.com");
  assert.equal(storedUser.phone, "+919682043203");
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
  const customEventNotice = "Discover events from 10–12 Nov.\nRegister by November 5, 2026.";
  const customEvent = await request("/api/analyze", {
    method: "POST", cookie: registration.cookie,
    body: { text: customEventNotice, role: "Student" }
  });
  assert.equal(customEvent.response.status, 200);
  assert.deepEqual(customEvent.result.analysis.actions.map((action) => action.evidence), [
    "Discover events from 10–12 Nov.",
    "Register by November 5, 2026."
  ]);
  assert.equal(customEvent.result.tasks.length, 2);
  const invalidRole = await request("/api/analyze", {
    method: "POST", cookie: registration.cookie,
    body: { text: "Discover events from 10–12 Nov.", role: "Admin" }
  });
  assert.equal(invalidRole.response.status, 400);

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
  const crossAccountCalendar = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/calendar.ics`, {
    cookie: secondAccount.cookie
  });
  assert.equal(crossAccountCalendar.response.status, 404);

  const ownedCalendar = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/calendar.ics`, {
    cookie: relogin.cookie
  });
  assert.equal(ownedCalendar.response.status, 200);
  assert.match(ownedCalendar.response.headers.get("content-type"), /text\/calendar/);
  assert.match(ownedCalendar.response.headers.get("content-disposition"), /attachment/);
  assert.match(ownedCalendar.result, /DTSTART;VALUE=DATE:20261015/);
  const unfoldedCalendar = ownedCalendar.result.replace(/\r\n /g, "");
  assert.match(unfoldedCalendar, /DESCRIPTION:Action:/);
  assert.match(unfoldedCalendar, /Exact sentence from your notice/);

  const smtpNames = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS", "SMTP_PORT", "SMTP_SECURE"];
  const previousSmtp = Object.fromEntries(smtpNames.map((name) => [name, process.env[name]]));
  const originalSendReminder = mailer.sendReminder;
  const emailMessage = {
    subject: "Please submit your registration form",
    text: "Action: Submit your signed registration form\nDeadline: October 15, 2026 (2026-10-15)\nPriority: High\nIf missed: No consequence stated\n\nExact sentence from your notice:\nPlease submit your signed registration form by October 15, 2026."
  };
  for (const name of smtpNames) delete process.env[name];
  try {
    const missingSmtp = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
      method: "POST", cookie: relogin.cookie
    });
    assert.equal(missingSmtp.response.status, 503);
    assert.match(missingSmtp.result.error, /SMTP_HOST/);
    assert.match(missingSmtp.result.error, /SMTP_FROM or SMTP_USER/);
    assert.equal(missingSmtp.result.sent, undefined);
    assert.equal(missingSmtp.result.accepted, undefined);
    const missingSmtpTask = await db.getCachedAnalysis(
      (await db.findUserByEmail("ada@example.com"))._id,
      firstAnalysis.result.hash,
      "Student"
    );
    assert.equal(missingSmtpTask.tasks[0].reminders.emailImmediate.status, "not_configured");

    for (const body of [
      { subject: " ", text: "Message" },
      { subject: "Line one\nLine two", text: "Message" },
      { subject: "x".repeat(201), text: "Message" },
      { subject: "Subject", text: "x".repeat(100001) }
    ]) {
      const invalidEmail = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
        method: "POST", cookie: relogin.cookie, body
      });
      assert.equal(invalidEmail.response.status, 400);
    }

    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_FROM = "reminders@example.test";
    const ada = await db.findUserByEmail("ada@example.com");
    const grace = await db.findUserByEmail("grace@example.com");
    await db.markReminder(ada._id, firstAnalysis.result.tasks[0].id, "email", {
      status: "sent", sentAt: new Date().toISOString()
    });
    let providerCalls = 0;
    mailer.sendReminder = async () => {
      providerCalls += 1;
      throw new Error("mock SMTP failure");
    };
    const failedEmail = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
      method: "POST", cookie: relogin.cookie
    });
    assert.equal(failedEmail.response.status, 502);
    assert.match(failedEmail.result.error, /SMTP could not send/);
    const ownedAnalysis = await db.getCachedAnalysis(ada._id, firstAnalysis.result.hash, "Student");
    assert.equal(ownedAnalysis.tasks[0].reminders.emailImmediate.status, "error");

    const wrongOwnerEmail = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
      method: "POST", cookie: secondAccount.cookie
    });
    assert.equal(wrongOwnerEmail.response.status, 404);
    const wrongOwnerCalendar = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/calendar.ics`, {
      cookie: secondAccount.cookie
    });
    assert.equal(wrongOwnerCalendar.response.status, 404);

    const recipients = [];
    const editedMessage = {
      subject: "Updated task-specific subject",
      text: "Action: Submit my signed registration\nDeadline: Oct 15, 2026\nPriority: High\nIf missed: I may be charged a fee\n\nExact source: Please submit your signed registration form by October 15, 2026."
    };
    mailer.sendReminder = async (task, owner, message) => {
      providerCalls += 1;
      assert.ok(task.ownerId);
      recipients.push(owner.email);
      if (owner.email === "ada@example.com") assert.deepEqual(message, editedMessage);
      return true;
    };
    const successRetry = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
      method: "POST", cookie: relogin.cookie,
      body: { ...editedMessage, to: "attacker@example.test" }
    });
    assert.equal(successRetry.response.status, 200);
    assert.equal(successRetry.result.accepted, true);
    assert.match(successRetry.result.message, /SMTP accepted.*ada@example\.com/);
    const duplicateSend = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
      method: "POST", cookie: relogin.cookie
    });
    assert.equal(duplicateSend.response.status, 409);
    assert.deepEqual(recipients, ["ada@example.com"]);
    const successfulTask = await db.getCachedAnalysis(ada._id, firstAnalysis.result.hash, "Student");
    assert.equal(successfulTask.tasks[0].reminders.email.status, "sent");
    assert.equal(successfulTask.tasks[0].reminders.emailImmediate.status, "sent");

    const graceTask = secondAnalysis.result.tasks[0];
    const graceSent = await request(`/api/tasks/${graceTask.id}/remind-email`, {
      method: "POST", cookie: secondAccount.cookie
    });
    assert.equal(graceSent.response.status, 200);
    assert.deepEqual(recipients, ["ada@example.com", "grace@example.com"]);
    const graceDuplicate = await request(`/api/tasks/${graceTask.id}/remind-email`, {
      method: "POST", cookie: secondAccount.cookie
    });
    assert.equal(graceDuplicate.response.status, 409);
    assert.deepEqual(recipients, ["ada@example.com", "grace@example.com"]);
  } finally {
    mailer.sendReminder = originalSendReminder;
    for (const name of smtpNames) {
      if (previousSmtp[name] === undefined) delete process.env[name];
      else process.env[name] = previousSmtp[name];
    }
  }

  const textNotice = "Please submit the signed document by October 20, 2026.";
  const textUpload = await request("/api/analyze-file", {
    method: "POST", cookie: relogin.cookie,
    body: {
      name: "notice.txt",
      mimeType: "text/plain",
      data: Buffer.from(textNotice).toString("base64"),
      role: "Student"
    }
  });
  assert.equal(textUpload.response.status, 200);
  assert.equal(textUpload.result.sourceName, "notice.txt");
  assert.equal(textUpload.result.analysis.actions[0].evidence, textNotice);

  const pdfBody = { name: "notice.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF fake upload").toString("base64"), role: "Student" };
  const noGemini = await request("/api/analyze-file", {
    method: "POST", cookie: relogin.cookie, body: pdfBody
  });
  assert.equal(noGemini.response.status, 503);
  assert.match(noGemini.result.error, /USE_AI=true and GEMINI_API_KEY/);
  const invalidUploadRole = await request("/api/analyze-file", {
    method: "POST", cookie: relogin.cookie, body: { ...pdfBody, role: "Administrator" }
  });
  assert.equal(invalidUploadRole.response.status, 400);
  process.env.USE_AI = "true";
  process.env.GEMINI_API_KEY = "test-api-key";
  const sourceText = "Please submit the signed document by October 15, 2026.";
  const geminiPayload = {
    sourceText,
    summary: "Submit the signed document by October 15.",
    actions: [{
      action: "Submit the signed document.",
      deadline: "2026-10-15",
      deadlineText: "October 15, 2026",
      priority: "High",
      consequence: "No consequence is explicitly stated in this notice.",
      consequenceEvidence: null,
      evidence: sourceText
    }]
  };
  const originalFetch = global.fetch;
  let geminiCalls = 0;
  let returnInvalidEvidence = false;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
      geminiCalls += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "application/pdf");
      if (geminiCalls === 1) assert.equal(body.contents[0].parts[1].inlineData.data, pdfBody.data);
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify(returnInvalidEvidence
                ? { ...geminiPayload, actions: [{ ...geminiPayload.actions[0], evidence: "An invented sentence." }] }
                : geminiPayload)
            }]
          }
        }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  try {
    const uploaded = await request("/api/analyze-file", {
      method: "POST", cookie: relogin.cookie, body: pdfBody
    });
    assert.equal(uploaded.response.status, 200);
    assert.equal(uploaded.result.sourceName, "notice.pdf");
    assert.equal(uploaded.result.analysis.actions[0].evidence, sourceText);
    assert.equal(uploaded.result.cached, false);
    const repeatUpload = await request("/api/analyze-file", {
      method: "POST", cookie: relogin.cookie, body: pdfBody
    });
    assert.equal(repeatUpload.response.status, 200);
    assert.equal(repeatUpload.result.cached, true);
    assert.equal(geminiCalls, 1);
    returnInvalidEvidence = true;
    const invalidEvidence = await request("/api/analyze-file", {
      method: "POST", cookie: relogin.cookie,
      body: { ...pdfBody, name: "different.pdf", data: Buffer.from("%PDF other").toString("base64") }
    });
    assert.equal(invalidEvidence.response.status, 502);
  } finally {
    global.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.USE_AI;
  }

  const blockedWhatsappOptIn = await request("/api/profile", {
    method: "PATCH", cookie: secondAccount.cookie, body: { whatsappReminders: true }
  });
  assert.equal(blockedWhatsappOptIn.response.status, 400);
  assert.match(blockedWhatsappOptIn.result.error, /manual only/);

  const crossAccountUpdate = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}`, {
    method: "PATCH", cookie: secondAccount.cookie, body: { status: "done" }
  });
  assert.equal(crossAccountUpdate.response.status, 404);
  const ownedUpdate = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}`, {
    method: "PATCH", cookie: relogin.cookie, body: { status: "done" }
  });
  assert.equal(ownedUpdate.response.status, 200);
  assert.equal(ownedUpdate.result.task.status, "done");
  const completedEmail = await request(`/api/tasks/${firstAnalysis.result.tasks[0].id}/remind-email`, {
    method: "POST", cookie: relogin.cookie
  });
  assert.equal(completedEmail.response.status, 409);

  const preferences = await request("/api/profile", {
    method: "PATCH", cookie: relogin.cookie,
    body: { emailReminders: false }
  });
  assert.equal(preferences.response.status, 200);
  assert.equal(preferences.result.user.emailReminders, false);
  assert.equal(preferences.result.user.whatsappReminders, false);
  const optedOutEmail = await request(`/api/tasks/${concurrentAnalyses[0].result.tasks[0].id}/remind-email`, {
    method: "POST", cookie: relogin.cookie
  });
  assert.equal(optedOutEmail.response.status, 403);

  const whatsappOptIn = await request("/api/profile", {
    method: "PATCH", cookie: relogin.cookie, body: { whatsappReminders: true }
  });
  assert.equal(whatsappOptIn.response.status, 400);
  assert.match(whatsappOptIn.result.error, /manual only/);

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
  assert.equal(secondUser.whatsappReminders, false);
  assert.equal(secondUser.phoneVerified, false);
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
  const unverifiedResult = await db.getCachedAnalysis(firstUser._id, unverifiedHash, "Student");
  assert.equal(unverifiedResult.tasks[0].reminders.email.status, "opted_out");

  const logout = await request("/api/auth/logout", { method: "POST", cookie: relogin.cookie });
  assert.equal(logout.response.status, 200);
  const afterLogout = await request("/api/auth/me", { cookie: logout.cookie });
  assert.equal(afterLogout.response.status, 401);
});
