const assert = require("node:assert/strict");
const { test } = require("node:test");
const { sendReminder, missingSmtpSettings } = require("../server/mailer");

test("mailer can be verified with an injected transport and only sends to the account email", async () => {
  const names = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS", "SMTP_PORT", "SMTP_SECURE"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    assert.deepEqual(missingSmtpSettings(), ["SMTP_HOST", "SMTP_FROM or SMTP_USER"]);
    assert.equal(await sendReminder({ action: "Submit form" }, { email: "ada@example.com" }), false);

    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_FROM = "notices@example.test";
    let transportOptions;
    let sentMessage;
    const sent = await sendReminder({
      action: "Submit form", deadline: "2026-11-05", evidence: "Submit by November 5."
    }, { email: "ada@example.com" }, {
      subject: "Please submit your form",
      text: "Action: Submit form\nExact evidence: Submit by November 5."
    }, (options) => {
      transportOptions = options;
      return { sendMail: async (message) => { sentMessage = message; } };
    });

    assert.equal(sent, true);
    assert.equal(transportOptions.host, "smtp.example.test");
    assert.equal(sentMessage.to, "ada@example.com");
    assert.equal(sentMessage.from, "notices@example.test");
    assert.equal(sentMessage.subject, "Please submit your form");
    assert.equal(sentMessage.text, "Action: Submit form\nExact evidence: Submit by November 5.");
    assert.equal(sentMessage.html, undefined);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("scheduled reminder defaults include action context as plain text", async () => {
  const names = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS", "SMTP_PORT", "SMTP_SECURE"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_FROM = "notices@example.test";
  for (const name of ["SMTP_USER", "SMTP_PASS", "SMTP_PORT", "SMTP_SECURE"]) delete process.env[name];
  try {
    let sentMessage;
    const sent = await sendReminder({
      action: "Submit the signed form.",
      deadline: null,
      priority: "High",
      consequence: "Late submissions may be rejected.",
      evidence: "Submit the signed form."
    }, { email: "ada@example.com" }, undefined, () => ({
      sendMail: async (message) => { sentMessage = message; }
    }));
    assert.equal(sent, true);
    assert.equal(sentMessage.to, "ada@example.com");
    assert.match(sentMessage.text, /Deadline: No deadline specified in the notice/);
    assert.match(sentMessage.text, /Priority: High/);
    assert.match(sentMessage.text, /If missed: Late submissions may be rejected\./);
    assert.match(sentMessage.text, /Action \(exact sentence from your notice\): Submit the signed form\./);
    assert.equal(sentMessage.html, undefined);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
