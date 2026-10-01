const assert = require("node:assert/strict");
const { test } = require("node:test");
const { calendarUrl, whatsappMessage, whatsappUrl } = require("../public/reminder-links");

test("WhatsApp link prefills the saved international phone, deadline, and original evidence for manual sending", () => {
  const link = whatsappUrl({
    action: "Submit the signed form",
    deadline: "2026-11-05",
    deadlineText: "November 5, 2026",
    evidence: "Please submit the signed form by November 5, 2026."
  }, { phone: "+919682043203" });
  const parsed = new URL(link);
  assert.equal(parsed.origin, "https://wa.me");
  assert.equal(parsed.pathname, "/919682043203");
  assert.match(parsed.searchParams.get("text"), /Submit the signed form/);
  assert.match(parsed.searchParams.get("text"), /November 5, 2026/);
  assert.match(parsed.searchParams.get("text"), /Please submit the signed form by November 5, 2026\./);
  assert.match(parsed.searchParams.get("text"), /press|review/i);
});

test("unsafe or unnormalized phone values never become WhatsApp recipients", () => {
  for (const phone of ["919682043203", "+91 96820 43203", "+1<script>"]) {
    const link = whatsappUrl({ action: "Review notice", evidence: "Review the notice." }, { phone });
    assert.equal(new URL(link).pathname, "/");
  }
});

test("custom WhatsApp text is URL-encoded without Twilio and is editable before manual sending", () => {
  const custom = "Please call me after class & confirm.";
  const url = new URL(whatsappUrl({
    action: "Original action",
    evidence: "Original evidence."
  }, { phone: "+919682043203" }, custom));
  assert.equal(url.pathname, "/919682043203");
  assert.equal(url.searchParams.get("text"), custom);
  assert.match(whatsappMessage({ action: "Task", evidence: "Exact source sentence." }), /Exact source sentence\./);
});

test("Google Calendar template carries the date and escaped source details", () => {
  const link = calendarUrl({
    action: "Submit & confirm",
    evidence: "Submit by November 5, 2026.",
    deadline: "2026-11-05"
  });
  const parsed = new URL(link);
  assert.equal(parsed.origin, "https://calendar.google.com");
  assert.equal(parsed.searchParams.get("dates"), "20261105/20261106");
  assert.equal(parsed.searchParams.get("text"), "Submit & confirm");
  assert.equal(parsed.searchParams.get("details"), 'From your notice: "Submit by November 5, 2026."');
});

test("invalid dates do not break rendering or produce Google Calendar links", () => {
  assert.equal(calendarUrl({ action: "Review", evidence: "Review it.", deadline: "2026-02-30" }), "");
});
