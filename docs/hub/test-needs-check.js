// node docs/hub/test-needs-check.js   — pure functions touched by H5
const assert = require("assert");
const rv = require("../../js/mcq-review.js");
const co = require("../../js/mcq-correct.js");

// --- mcqBulkNorm_: flag is "yes" or blank, nothing else
assert.strictEqual(co.mcqBulkNorm_("needs_check", "yes"), "yes");
assert.strictEqual(co.mcqBulkNorm_("needs_check", " YES "), "yes");
assert.strictEqual(co.mcqBulkNorm_("needs_check", ""), "");
assert.strictEqual(co.mcqBulkNorm_("needs_check", undefined), "");
assert.strictEqual(co.mcqBulkNorm_("needs_check", "no"), "");

// --- verify compare: flag set / cleared
let bad = co.mcqBulkCompare_([{ mcq_id: "a", fields: { needs_check: "yes" } }], [{ mcq_id: "a", needs_check: "yes" }]);
assert.strictEqual(bad.length, 0);
bad = co.mcqBulkCompare_([{ mcq_id: "a", fields: { needs_check: "yes" } }], [{ mcq_id: "a", needs_check: "" }]);
assert.strictEqual(bad.length, 1, "column missing / old script: must show a mismatch");
bad = co.mcqBulkCompare_([{ mcq_id: "a", fields: { needs_check: "" } }], [{ mcq_id: "a" }]);
assert.strictEqual(bad.length, 0);

// --- Review: "Mark as checked when saved"
const rows = new Map([
  ["f1", { id: "f1", question_no: 1, question: "Old", needs_check: "yes", options: ["a", "b", "c", "d"], correct_option: 1, explanation: "e" }],
  ["n1", { id: "n1", question_no: 2, question: "Old2", needs_check: "", options: ["a", "b", "c", "d"], correct_option: 1, explanation: "e" }],
  ["f2", { id: "f2", question_no: 3, question: "Same", needs_check: "yes", options: ["a", "b", "c", "d"], correct_option: 1, explanation: "e" }]
]);
const drafts = new Map();
rv.mcqRvSetDraft_(drafts, rows.get("f1"), "question", "New text");
rv.mcqRvSetDraft_(drafts, rows.get("n1"), "question", "New text 2");
// f2: draft equal to the saved text -> no real change -> must NOT be touched, flag stays
rv.mcqRvSetDraft_(drafts, rows.get("f2"), "question", "Same");

let ups = rv.mcqRvBuildUpdates_(drafts, rows, { clearFlag: true });
const byId = Object.fromEntries(ups.map(u => [u.mcq_id, u.fields]));
assert.strictEqual(byId.f1.needs_check, "", "flagged + edited -> flag cleared in the same update");
assert.strictEqual(byId.f1.question, "New text");
assert.ok(!("needs_check" in byId.n1), "not flagged -> no needs_check field");
assert.ok(!byId.f2, "unchanged question is not part of the save and keeps its flag");

ups = rv.mcqRvBuildUpdates_(drafts, rows, { clearFlag: false });
assert.ok(!("needs_check" in Object.fromEntries(ups.map(u => [u.mcq_id, u.fields])).f1), "checkbox OFF keeps the flag");
ups = rv.mcqRvBuildUpdates_(drafts, rows);   // old call style still works
assert.ok(!("needs_check" in Object.fromEntries(ups.map(u => [u.mcq_id, u.fields])).f1));

assert.strictEqual(rv.mcqRvFieldLabel_("needs_check"), "Needs-check flag");
console.log("ALL TESTS PASSED");
