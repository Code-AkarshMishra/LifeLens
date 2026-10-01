const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTaskIcs } = require("../server/calendar");

test("creates an escaped all-day UTC calendar event from a deadline and source evidence", () => {
  const ics = createTaskIcs({
    id: "task-123",
    action: "Register, then confirm; today",
    evidence: "Register by Nov 10.\nBring your ID.",
    deadline: "2026-11-10"
  }, new Date("2026-10-01T08:30:00.000Z"));
  assert.match(ics, /DTSTAMP:20261001T083000Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261110/);
  assert.match(ics, /DTEND;VALUE=DATE:20261111/);
  assert.match(ics, /SUMMARY:Register\\, then confirm\\; today/);
  assert.match(ics, /DESCRIPTION:From your notice: Register by Nov 10\.\\nBring your ID\./);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
});

test("rejects missing or invalid deadlines instead of creating a misleading event", () => {
  assert.throws(() => createTaskIcs({ action: "Task" }), /valid task deadline/);
  assert.throws(() => createTaskIcs({ action: "Task", deadline: "2026-02-30" }), /not a valid calendar date/);
});

test("folds long ICS content at valid UTF-8 boundaries", () => {
  const ics = createTaskIcs({
    id: "task-long",
    action: "Review this notice",
    evidence: "é".repeat(120),
    deadline: "2026-11-10"
  });
  assert.ok(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75));
  assert.match(ics, /\r\n /);
});
