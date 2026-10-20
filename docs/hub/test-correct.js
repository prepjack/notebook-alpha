// Run: node docs/hub/test-correct.js   (tests the pure functions in js/mcq-correct.js)
const assert = require("assert");
const C = require("../../js/mcq-correct.js");
const { parseAnswerKey: P } = C;

const nos = [1, 2, 3, 4, 5];
const cnt = [4, 4, 4, 4, 6];
const ap = r => r.applied.map(a => a.qno + ":" + a.option).join(" ");

// --- formats from the spec
assert.strictEqual(ap(P("1-A 2-C 3-B", nos, cnt)), "1:1 2:3 3:2");
assert.strictEqual(ap(P("1.A 2.C 3.B", nos, cnt)), "1:1 2:3 3:2");
assert.strictEqual(ap(P("1) a\n2) c\n3) b", nos, cnt)), "1:1 2:3 3:2");
assert.strictEqual(ap(P("1:3, 2:1, 3:4", nos, cnt)), "1:3 2:1 3:4");
assert.strictEqual(ap(P("1 A 2 C 3 B", nos, cnt)), "1:1 2:3 3:2");
assert.strictEqual(ap(P("1A,2C;3B", nos, cnt)), "1:1 2:3 3:2");
assert.strictEqual(ap(P("Q1-A q2.c", nos, cnt)), "1:1 2:3");
assert.strictEqual(ap(P("१-A २-C", nos, cnt)), "1:1 2:3");          // Devanagari digits
assert.strictEqual(ap(P("5-F", nos, cnt)), "5:6");                    // 6 options

// --- messy example from the manual test
let r = P("1) a, 2.c  3:2  99-A  5-Z", nos, cnt);
assert.strictEqual(ap(r), "1:1 2:3 3:2");
assert.deepStrictEqual(r.unknown, [99]);
assert.deepStrictEqual(r.invalid, ["5-Z"]);

// --- matches by question NUMBER, not position
r = P("30-B 10-D", [10, 20, 30], [4, 4, 4]);
assert.strictEqual(ap(r), "10:4 30:2");

// --- out of range: 4-option question cannot take E
r = P("3-E 3-D", nos, cnt);
assert.deepStrictEqual(r.outOfRange, ["3-E"]);
assert.strictEqual(ap(r), "3:4");
r = P("1:5 2:6", nos, cnt);
assert.deepStrictEqual(r.outOfRange, ["1-E", "2-F"]);
assert.strictEqual(r.applied.length, 0);

// --- digit options outside 1-6 are invalid
r = P("1:7 2:0", nos, cnt);
assert.deepStrictEqual(r.invalid, ["1:7", "2:0"]);

// --- junk is reported, not swallowed
r = P("hello 1-A world", nos, cnt);
assert.strictEqual(ap(r), "1:1");
assert.deepStrictEqual(r.invalid, ["hello", "world"]);
r = P("1:35", nos, cnt);
assert.deepStrictEqual(r.invalid, ["1:35"]);

// --- duplicates: last wins, reported
r = P("1-A 1-C", nos, cnt);
assert.strictEqual(ap(r), "1:3"); assert.deepStrictEqual(r.duplicates, [1]);

// --- compact string only when length equals number of questions
r = P("ACBDA", nos, cnt);
assert.strictEqual(r.compact, true);
assert.strictEqual(ap(r), "1:1 2:3 3:2 4:4 5:1");
r = P("A C B D A", nos, cnt);
assert.strictEqual(r.compact, true);
r = P("ACBD", nos, cnt);
assert.strictEqual(r.compact, false); assert.strictEqual(r.applied.length, 0);
assert.deepStrictEqual(r.compactMismatch, { got: 4, expected: 5 });
r = P("ACBEA", [1,2,3,4,5], [4,4,4,4,4]);            // E on a 4-option question
assert.deepStrictEqual(r.outOfRange, ["4-E"]); assert.strictEqual(r.applied.length, 4);

// --- empty / nonsense
assert.deepStrictEqual(P("", nos, cnt).applied, []);
assert.deepStrictEqual(P("   ", nos, cnt).invalid, []);

// --- saved option reading
const S = C.mcqCorrectSavedOption_;
assert.strictEqual(S({ correct_option: 3 }), 3);
assert.strictEqual(S({ correct_option: "2" }), 2);
assert.strictEqual(S({ correct_option: "d" }), 4);
assert.strictEqual(S({ correct_option: "" }), 0);
assert.strictEqual(S({ correct_option: 0 }), 0);
assert.strictEqual(S({}), 0);
assert.strictEqual(S({ correct_option: 7 }), 0);

// --- diff
const rows = [{ id: "a", qno: 7, saved: 2 }, { id: "b", qno: 9, saved: 0 }, { id: "c", qno: 10, saved: 3 }];
const ch = C.buildAnswerKeyChanges_(rows, { a: 4, b: 1, c: 3 });          // c same as saved -> not a change
assert.deepStrictEqual(ch.map(C.formatAnswerKeyChange_), ["Q7: B → D", "Q9: (none) → A"]);

// --- chunking
assert.deepStrictEqual(C.mcqBulkChunk_([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);
assert.strictEqual(C.mcqBulkChunk_(Array(250).fill(0), 100).length, 3);

// --- compare: numbers as numbers, text trimmed, missing row reported
const ups = [{ mcq_id: "m1", fields: { correct_option: 3 } }, { mcq_id: "m2", fields: { correct_option: "B", explanation: " hi " } },
             { mcq_id: "m3", fields: { correct_option: "" } }, { mcq_id: "zz", fields: { correct_option: 1 } },
             { mcq_id: "m4", fields: { explanation: "-minus" } }];
const raw = [{ mcq_id: "m1", correct_option: "3" }, { mcq_id: "m2", correct_option: 1, explanation: "hi" },
             { mcq_id: "m3", correct_option: 0 }, { mcq_id: "m4", explanation: "'-minus" }];
const mm = C.mcqBulkCompare_(ups, raw);
assert.deepStrictEqual(mm.map(m => m.mcq_id + ":" + m.field), ["m2:correct_option", "zz:correct_option"]);
assert.strictEqual(mm[1].got, "(not found in Sheet)");

// --- previous values for undo
assert.strictEqual(C.mcqBulkPrevValue_("correct_option", 0), "");
assert.strictEqual(C.mcqBulkPrevValue_("correct_option", "C"), 3);
assert.strictEqual(C.mcqBulkPrevValue_("explanation", null), "");

// --- verify loop: Sheet lags twice, then catches up (3 tries, 2 s apart in real use)
(async () => {
    let calls = 0, sleeps = [];
    const lag = async () => { calls++; return calls < 3 ? [{ mcq_id: "m1", correct_option: 1 }] : [{ mcq_id: "m1", correct_option: 3 }]; };
    let v = await C.mcqBulkVerify_([{ mcq_id: "m1", fields: { correct_option: 3 } }], lag, { sleep: ms => { sleeps.push(ms); return Promise.resolve(); } });
    assert.strictEqual(v.mismatches.length, 0); assert.strictEqual(v.attempts, 3); assert.deepStrictEqual(sleeps, [2000, 2000]);

    // never catches up -> 3 attempts, mismatch reported
    calls = 0;
    v = await C.mcqBulkVerify_([{ mcq_id: "m1", fields: { correct_option: 3 } }], async () => { calls++; return [{ mcq_id: "m1", correct_option: 1 }]; }, { delayMs: 0 });
    assert.strictEqual(calls, 3); assert.strictEqual(v.mismatches.length, 1);

    // one transient network error is survived
    calls = 0;
    v = await C.mcqBulkVerify_([{ mcq_id: "m1", fields: { correct_option: 3 } }], async () => { if (++calls === 1) throw new Error("net"); return [{ mcq_id: "m1", correct_option: 3 }]; }, { delayMs: 0 });
    assert.strictEqual(v.mismatches.length, 0);

    // network down all the time -> throws
    await assert.rejects(() => C.mcqBulkVerify_([{ mcq_id: "m1", fields: { correct_option: 3 } }], async () => { throw new Error("offline"); }, { delayMs: 0 }), /offline/);

    console.log("ALL TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
