// Run: node docs/hub/test-export.js   (tests the pure functions in js/mcq-export.js)
const assert = require("assert");
const E = require("../../js/mcq-export.js");

const rows = [
  { id: "m2", question_no: "2", language: "English", question: "Second?", options: ["a2","b2","c2","d2"], answer: 2, correct_option: 3, explanation: "Because C.", tags: "t1, t2", source_qid: "Q-22", source_question_no: "22", collection_id_ref: "c1", passage_id: "p1" },
  { id: "m1", question_no: "1", language: "English", question: "First?", options: ["a1","b1","c1","d1"], answer: 1, correct_option: 2, explanation: "Because B.",
    question_alt: "पहला?", alt_language: "Hindi", option_a_alt: "अ", option_b_alt: "ब", option_c_alt: "", option_d_alt: "द", explanation_alt: "क्योंकि ब।", collection_id_ref: "c1", passage_id: "p1" },
  { id: "m3", question_no: "3", language: "English", question: "No answer?", options: ["x","y"], answer: 0, correct_option: "", explanation: "", collection_id_ref: "c1" }
];
const passages = [{ passage_id: "p1", content: "Read this.", content_alt: "यह पढ़ो।" }];

// sort
const sorted = E.mcqExportSortRows_(rows);
assert.deepStrictEqual(sorted.map(r => r.id), ["m1","m2","m3"]);

// full, language 1
let r = E.buildMcqExport(sorted, passages, { lang: "1", layout: "full", paperTitle: "Paper X" });
console.log(r.text);
assert(r.text.startsWith("Q1. First?\nA) a1\nB) b1\nC) c1\nD) d1\nCorrect: B) b1\nExplanation: Because B."));
assert(r.text.includes("Correct: —"));
assert(!r.text.includes("Passage"));
assert.strictEqual(r.count, 3);

// both languages: same letters, Hindi fallback for blank option C
r = E.buildMcqExport(sorted, passages, { lang: "both", passage: true, tags: true, source: true, paperTitle: "Paper X" });
console.log("\n--- both ---\n" + r.text);
assert(r.text.includes("(Hindi)\nPassage:\nयह पढ़ो।\nQ1. पहला?\nA) अ\nB) ब\nC) c1\nD) द\nCorrect: B) ब"));
assert.strictEqual((r.text.match(/Read this\./g) || []).length, 1, "passage once");
assert(r.text.includes("Tags: t1, t2"));
assert(r.text.includes("Source: Paper X · Source Q no: 22 · Question ID: Q-22"));

// language 2 falls back to language 1 for rows without a second language
r = E.buildMcqExport(sorted, passages, { lang: "2" });
assert(r.text.includes("Q1. पहला?") && r.text.includes("Q2. Second?"));

// questions only: never leaks answers
r = E.buildMcqExport(sorted, passages, { layout: "questions", correct: true, explanation: true });
assert(!/Correct:|Explanation:/.test(r.text));

// key only
r = E.buildMcqExport(sorted, passages, { layout: "key" });
assert.strictEqual(r.text, "1-B 2-C 3-—");

// toggles
r = E.buildMcqExport(sorted, passages, { number: false, options: false, correct: false, explanation: false });
assert.strictEqual(r.text, "First?\n\nSecond?\n\nNo answer?");

// csv
r = E.buildMcqExport(sorted, passages, { lang: "both", tags: true, source: true });
assert.deepStrictEqual(r.csvRows[0], ["question_no","language","question","option_a","option_b","option_c","option_d","option_e","option_f","correct","explanation","tags","source_qid"]);
assert.strictEqual(r.csvRows.length, 1 + 4);               // m1 x2 languages, m2, m3
assert.strictEqual(r.csvRows[2][1], "Hindi");
assert.strictEqual(r.csvRows[2][9], "B");
assert.strictEqual(r.csvRows[4][9], "");                   // no answer
const csv = E.mcqExportCsvString_([["a,b", 'He said "hi"', "x\ny", "plain"]]);
assert.strictEqual(csv, '"a,b","He said ""hi""","x\ny",plain');

// print html: escaping + page-break class
const html = E.buildMcqPrintHtml([{ id: "z", question_no: "1", question: "<script>alert(1)</script> & x", options: ["<b>a</b>", "b"], answer: 0, correct_option: 1, explanation: "" }], [], { paperTitle: "T <i>" }, null, "2026-10-19");
assert(!html.includes("<script>") && !html.includes("<i>") && html.includes("&lt;script&gt;"));
assert(html.includes("mcq-print-q"));

// file names
assert.strictEqual(E.mcqExportFileName_("UGC NET Paper-1 (2019)", "csv", new Date(2026, 9, 19)), "ugc-net-paper-1-2019_2026-10-19.csv");
assert.strictEqual(E.mcqExportFileName_("पुस्तकालय विज्ञान", "md", new Date(2026, 9, 19)), "पुस्तकालय-विज्ञान_2026-10-19.md");
assert.strictEqual(E.mcqExportSlug_("!!!"), "mcq-export");
console.log("\nALL TESTS PASSED");
