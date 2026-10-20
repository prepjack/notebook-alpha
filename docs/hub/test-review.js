// Run: node docs/hub/test-review.js   (tests the pure functions in js/mcq-review.js)
const assert = require("assert");
const fs = require("fs");
const path = require("path");

global.buildMcqExport = require("../../js/mcq-export.js").buildMcqExport;

// Pull the REAL explanation rule out of mcq.js, so this test also proves the prompt reuses it.
const mcqSrc = fs.readFileSync(path.join(__dirname, "../../js/mcq.js"), "utf8");
const m = /const MCQ_EXPLANATION_FORMAT_RULE_ = ("(?:[^"\\]|\\.)*");/.exec(mcqSrc);
assert.ok(m, "MCQ_EXPLANATION_FORMAT_RULE_ not found in mcq.js");
global.MCQ_EXPLANATION_FORMAT_RULE_ = JSON.parse(m[1]);
// ...and that the Add MCQs prompt really uses the constant (no second copy of the rule).
assert.ok(/EXPLANATION FORMAT \(@explanation and @alt_explanation\): " \+ MCQ_EXPLANATION_FORMAT_RULE_/.test(mcqSrc));
assert.strictEqual((mcqSrc.match(/it is shown to the learner whether they picked/g) || []).length, 1);

const R = require("../../js/mcq-review.js");
const { buildMcqCorrectionPrompt: build, parseMcqCorrectionReply: parse } = R;

// ---------- fixtures: mapped rows like mapMcqRow gives
const rows = [
    { id: "m7", question_no: "7", language: "English", question: "Capital of France?", options: ["Berlin", "Paris", "Rome", "Madrid"],
      answer: 1, correct_option: 2, explanation: "Old explanation.", collection_id_ref: "c1",
      alt_language: "Hindi", question_alt: "फ्रांस की राजधानी?", option_a_alt: "बर्लिन", option_b_alt: "पेरिस", option_c_alt: "रोम", option_d_alt: "मैड्रिड", explanation_alt: "पुरानी व्याख्या।" },
    { id: "m9", question_no: "9", language: "English", question: "Four options only?", options: ["a", "b", "c", "d"],
      answer: 0, correct_option: 1, explanation: "", collection_id_ref: "c1" },
    { id: "m11", question_no: "11", language: "English", question: "Six options?", options: ["a", "b", "c", "d", "e", "f"],
      answer: 4, correct_option: 5, explanation: "x", collection_id_ref: "c1" }
];
const byNo = new Map(rows.map(r => [Number(r.question_no), r]));
const byId = new Map(rows.map(r => [r.id, r]));

// ================= buildMcqCorrectionPrompt =================
let p = build(rows, { verify: true, rewrite: true, extra: "keep it short" });
assert.ok(p.includes("Capital of France?") && p.includes("फ्रांस की राजधानी?"), "both languages included");
assert.ok(p.includes("Q7. Capital of France?") && p.includes("B) Paris"), "export text format with letters");
assert.ok(p.includes("Correct: B) Paris") && p.includes("Explanation: Old explanation."), "current answer + explanation included");
assert.ok(p.includes(global.MCQ_EXPLANATION_FORMAT_RULE_), "exact explanation rule reused");
assert.ok(p.includes("Verify the correct answer") && p.includes("Rewrite the explanation"));
assert.ok(!p.includes("Fix spelling") && !p.includes("second-language text (question"), "unticked tasks absent");
assert.ok(p.includes("Extra instructions from the owner: keep it short"));
assert.ok(p.includes("## Q7") && p.includes("explanation_alt: ...") && p.includes("## Q9") && p.includes("option_c: ..."), "reply format example");
assert.ok(/Valid field names are exactly: correct, question, option_a, .*option_f, explanation, question_alt, option_a_alt, .*option_f_alt, explanation_alt\./.test(p));
assert.ok(/never reorder options and never add or remove options/i.test(p) && /no markdown code fences/i.test(p) && /Devanagari/.test(p));
p = build(rows, { typos: true, translation: true });
assert.ok(p.includes("Fix spelling") && p.includes("second-language text") && !p.includes("EXPLANATION STYLE"), "no style block when explanation not requested");
assert.throws(() => build(rows, {}), /Tick at least one task/);
assert.throws(() => build([], { verify: true }), /No questions/);
const saved = global.MCQ_EXPLANATION_FORMAT_RULE_; delete global.MCQ_EXPLANATION_FORMAT_RULE_;
assert.throws(() => build(rows, { rewrite: true }), /explanation rules are missing/);
assert.ok(build(rows, { rewrite: true, explanationRules: "RULE-X" }).includes("RULE-X"));
global.MCQ_EXPLANATION_FORMAT_RULE_ = saved;
// passage included for comprehension questions
p = build([Object.assign({}, rows[1], { passage_id: "p1" })], { verify: true, passages: [{ passage_id: "p1", content: "READ THIS PASSAGE" }] });
assert.ok(p.includes("READ THIS PASSAGE"));

// ================= parseMcqCorrectionReply =================
const ids = r => r.items.map(i => i.qno + ":" + i.field).join(" ");

// --- happy path, all header styles, fences
let r = parse("```\n## Q7\ncorrect: C\nexplanation: ✅ Correct: **Rome**\n\n❌ **Paris** wrong.\nexplanation_alt: नई व्याख्या\n### Q9\nquestion: New question?\n**Q11**\noption_f: new f\n```", byNo);
assert.strictEqual(ids(r), "7:correct_option 7:explanation 7:explanation_alt 9:question 11:option_f");
assert.strictEqual(r.items[0].after, 3); assert.strictEqual(r.items[0].before, 2);
assert.strictEqual(r.items[1].after, "✅ Correct: **Rome**\n\n❌ **Paris** wrong.", "multi-line value, blank line kept");
assert.strictEqual(r.questions, 3); assert.strictEqual(r.fields, 5); assert.strictEqual(r.ignored.length, 0);
r = parse("Q7\ncorrect: 3", byNo); assert.strictEqual(r.items[0].after, 3);
r = parse("**Q7**\n**correct:** d", byNo); assert.strictEqual(r.items[0].after, 4);          // bold field name
r = parse("**Q7**\n**correct**: **D**", byNo); assert.strictEqual(r.items[0].after, 4);      // bold value
r = parse("**Q7**\n**correct:** b", byNo); assert.strictEqual(r.items.length, 0);            // b == current answer (B) -> ignored
assert.ok(/same as the current answer/.test(r.ignored[0].reason));
r = parse("## Q७\ncorrect: D", byNo); assert.strictEqual(r.items[0].qno, 7);   // Devanagari digit in header

// --- test 4: malformed reply: missing ##, Q99, foo:, correct: Z
r = parse("Here are the fixes:\ncorrect: B\n## Q99\ncorrect: A\n## Q7\ncorrect: Z\nfoo: bar\nexplanation: Good one\n## Q9\ncorrect: 2", byNo);
assert.strictEqual(ids(r), "7:explanation 9:correct_option");
const reasons = r.ignored.map(g => (g.qno || "") + "|" + g.field + "|" + g.reason).join("\n");
assert.ok(/text outside any question block \(2 lines\)/.test(reasons), reasons);
assert.ok(/99\|\|question number 99 is not in this paper/.test(reasons), reasons);
assert.ok(/7\|correct\|could not read the answer "Z"/.test(reasons), reasons);
assert.ok(/7\|foo\|unknown field name/.test(reasons), reasons);
assert.strictEqual(r.ignored.length, 4);

// --- test 5: 4-option question, option_e -> ignored; 6-option question accepts it
r = parse("## Q9\noption_e: extra\n## Q11\noption_e: E changed", byNo);
assert.strictEqual(ids(r), "11:option_e");
assert.ok(/only 4 options/.test(r.ignored[0].reason));
// no second language -> *_alt ignored
r = parse("## Q9\nexplanation_alt: hi\nquestion_alt: hi", byNo);
assert.strictEqual(r.items.length, 0); assert.ok(r.ignored.every(g => /no second language/.test(g.reason)));
// option letter out of range for correct
r = parse("## Q9\ncorrect: E", byNo); assert.ok(/does not exist/.test(r.ignored[0].reason));
// not-allowed Sheet columns can never come in
r = parse("## Q7\norigin: pyq\nderived_from: x\nmcq_id: hack\ncorrect_option: 2", byNo);
assert.strictEqual(r.items.length, 0); assert.strictEqual(r.ignored.length, 4);

// --- test 6: prose inside a multi-line explanation
r = parse("## Q7\nexplanation: First line\ncorrect: the capital city is Paris\nNote: this is prose\nin_this_case: kept? \nexplanation_alt: ok", byNo);
assert.strictEqual(ids(r), "7:explanation 7:explanation_alt");
assert.ok(r.items[0].after.includes("correct: the capital city is Paris"), "long `correct:` text stays prose");
assert.ok(r.items[0].after.includes("Note: this is prose"), "unknown `Note:` stays prose in multi-line field");
assert.ok(r.ignored.some(g => g.field === "in_this_case"), "underscore name is reported, not swallowed");
// a ONE-character `correct:` line DOES count as the field (documented)
r = parse("## Q7\nexplanation: text\ncorrect: D", byNo);
assert.strictEqual(ids(r), "7:explanation 7:correct_option"); assert.strictEqual(r.items[0].after, "text");

// --- same text as now -> ignored; empty -> ignored; repeated -> last wins
r = parse("## Q7\nquestion: Capital of France?\nexplanation:\n## Q7\nexplanation: one\nexplanation: two", byNo);
assert.strictEqual(r.items.length, 1); assert.strictEqual(r.items[0].after, "two");
assert.ok(r.ignored.some(g => /same as the current text/.test(g.reason)));
assert.ok(r.ignored.some(g => /empty value/.test(g.reason)));
assert.ok(r.ignored.some(g => /repeated/.test(g.reason)));
// trailing --- separators are not part of the value
r = parse("## Q7\nexplanation: abc\n---\n## Q9\nquestion: Z?", byNo);
assert.strictEqual(r.items[0].after, "abc");
// NONE / empty / garbage never crash
assert.strictEqual(parse("NONE", byNo).items.length, 0);
assert.strictEqual(parse("", byNo).items.length, 0);
assert.strictEqual(parse(null, byNo).items.length, 0);
assert.strictEqual(parse("## Q7", {}).items.length, 0);
assert.strictEqual(parse("## Q7\ncorrect: B", { 7: rows[0] }).ignored.length, 1);   // plain object map works

// ================= draft helpers =================
const drafts = new Map();
R.mcqRvSetDraft_(drafts, rows[0], "explanation", "  New text  ");
R.mcqRvSetDraft_(drafts, rows[0], "option_b_alt", "पेरिस"); // same as saved -> no draft
R.mcqRvSetDraft_(drafts, rows[0], "correct_option", 2);     // same as saved -> no draft
R.mcqRvSetDraft_(drafts, rows[1], "correct_option", 3);
assert.deepStrictEqual(R.mcqRvDraftCount_(drafts), { questions: 2, fields: 2 });
R.mcqRvSetDraft_(drafts, rows[1], "correct_option", 1);     // back to saved -> draft removed
assert.deepStrictEqual(R.mcqRvDraftCount_(drafts), { questions: 1, fields: 1 });
let up = R.mcqRvBuildUpdates_(drafts, byId);
assert.deepStrictEqual(up, [{ mcq_id: "m7", fields: { explanation: "New text" } }], "trimmed, only changed");
R.mcqRvSetDraft_(drafts, rows[0], "correct_option", 4);
up = R.mcqRvBuildUpdates_(drafts, byId);
assert.strictEqual(up[0].fields.correct_option, 4); assert.strictEqual(typeof up[0].fields.correct_option, "number");
// empty option / question blocked, empty alt allowed
R.mcqRvSetDraft_(drafts, rows[0], "option_a", "   ");
R.mcqRvSetDraft_(drafts, rows[0], "option_a_alt", "");
let probs = R.mcqRvValidate_(drafts, byId);
assert.strictEqual(probs.length, 1); assert.strictEqual(probs[0].field, "option_a");
// allowed fields: 4-option question has no option_e; no alt -> no *_alt; origin never
assert.ok(!R.mcqRvAllowedFields_(rows[1]).includes("option_e"));
assert.ok(!R.mcqRvAllowedFields_(rows[1]).includes("explanation_alt"));
assert.ok(R.mcqRvAllowedFields_(rows[2]).includes("option_f"));
assert.ok(!R.mcqRvAllowedFields_(rows[0]).includes("origin"));
// serialize round trip + prune against fresh originals
const back = R.mcqRvDeserialize_(JSON.parse(JSON.stringify(R.mcqRvSerialize_(drafts))));
assert.deepStrictEqual(R.mcqRvDraftCount_(back), R.mcqRvDraftCount_(drafts));
back.set("gone", { question: "x" });
const fresh = new Map([["m7", Object.assign({}, rows[0], { explanation: "New text" })]]);   // Sheet now equals the draft
R.mcqRvPrune_(back, fresh);
assert.ok(!back.get("m7").explanation, "saved value pruned"); assert.ok(!back.has("gone"), "unknown id pruned");
// legacy / odd saved answers
assert.strictEqual(R.mcqRvOriginal_({ correct_option: "C", options: ["a", "b", "c"] }, "correct_option"), 3);
assert.strictEqual(R.mcqRvOriginal_({ correct_option: 6, options: ["a", "b", "c", "d"] }, "correct_option"), 0, "answer beyond option count = none");
assert.strictEqual(R.mcqRvFieldLabel_("option_c_alt"), "Option C (Language 2)");

console.log("ALL TESTS PASSED");
