const assert = require("node:assert/strict");
const { test } = require("node:test");
const { analyzeNotice, splitSentences } = require("../server/parser");
const { analyze } = require("../server/ai");

test("notice lines and headings are kept as separate evidence sentences", () => {
  const notice = "Subject: Registration\n\nPlease complete registration by October 15, 2026.\nSubmit the signed form.";
  assert.deepEqual(splitSentences(notice), [
    "Subject: Registration",
    "Please complete registration by October 15, 2026.",
    "Submit the signed form."
  ]);
  const result = analyzeNotice(notice);
  assert.deepEqual(result.actions.map((action) => action.evidence), [
    "Please complete registration by October 15, 2026.",
    "Submit the signed form."
  ]);
  assert.ok(result.actions.every((action) => notice.includes(action.evidence)));
});

test("consequences are only attached to a related action", () => {
  const notice = [
    "Please complete your course registration by October 15, 2026.",
    "Submit your signed course selection form to the Registrar's Office before the deadline.",
    "Students who do not register by the deadline may be charged a late fee and could lose their place in selected courses.",
    "Contact the Registrar's Office if you need help."
  ].join("\n\n");
  const result = analyzeNotice(notice);
  assert.equal(result.actions.length, 3);
  assert.equal(result.actions[0].consequenceEvidence, "Students who do not register by the deadline may be charged a late fee and could lose their place in selected courses.");
  assert.equal(result.actions[1].consequenceEvidence, null);
  assert.equal(result.actions[2].consequenceEvidence, null);
});

test("demo notice extracts each actionable sentence without promoting its consequence", () => {
  const notice = `Subject: Action required — Student registration

Please complete your course registration by October 15, 2026. Submit your signed course selection form to the Registrar's Office before the deadline.

Students who do not register by the deadline may be charged a late fee and could lose their place in selected courses. Contact the Registrar's Office if you need help.`;
  const result = analyzeNotice(notice, "Student");
  assert.deepEqual(result.actions.map((action) => action.evidence), [
    "Please complete your course registration by October 15, 2026.",
    "Submit your signed course selection form to the Registrar's Office before the deadline.",
    "Contact the Registrar's Office if you need help."
  ]);
  assert.equal(result.actions[0].deadline, "2026-10-15");
  assert.ok(result.actions.every((action) => notice.includes(action.evidence)));
  assert.equal(result.actions[2].consequenceEvidence, null);
});

test("an event invitation with a date window is actionable, but a bare Discover Events heading is ambiguous", () => {
  const heading = analyzeNotice("Discover Events");
  assert.equal(heading.actions.length, 0);
  assert.match(heading.summary, /No clear action/);

  const notice = [
    "Discover events from 10–12 Nov.",
    "Register by November 5, 2026.",
    "Bring your student ID."
  ].join("\n");
  const result = analyzeNotice(notice);
  assert.deepEqual(result.actions.map((action) => action.evidence), [
    "Discover events from 10–12 Nov.",
    "Register by November 5, 2026.",
    "Bring your student ID."
  ]);
  assert.equal(result.actions[0].deadline, null);
  assert.equal(result.actions[1].deadline, "2026-11-05");
  assert.ok(result.actions.every((action) => notice.includes(action.evidence)));
});

test("Gemini invalid sentence evidence falls back to the local parser for typed notice analysis", async () => {
  const previousUseAi = process.env.USE_AI;
  const previousApiKey = process.env.GEMINI_API_KEY;
  const previousFetch = global.fetch;
  process.env.USE_AI = "true";
  process.env.GEMINI_API_KEY = "test-key";
  global.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      summary: "Invented analysis",
      actions: [{ action: "Invented task", evidence: "Not in the notice." }]
    }) }] } }]
  }), { status: 200, headers: { "Content-Type": "application/json" } });
  try {
    const notice = "Discover events from 10–12 Nov.";
    const result = await analyze(notice, "Student");
    assert.equal(result.role, "Student");
    assert.deepEqual(result.actions.map((action) => action.evidence), [notice]);
  } finally {
    global.fetch = previousFetch;
    if (previousUseAi === undefined) delete process.env.USE_AI;
    else process.env.USE_AI = previousUseAi;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});
