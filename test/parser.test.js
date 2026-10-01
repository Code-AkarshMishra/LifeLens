const assert = require("node:assert/strict");
const { test } = require("node:test");
const { analyzeNotice, splitSentences } = require("../server/parser");

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
