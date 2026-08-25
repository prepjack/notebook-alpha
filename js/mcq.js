/* =========================================================
   MCQ PAGE — separate tab/window
   ========================================================= */

let currentMcqs = [];
let currentMcqIndex = 0;
let attemptedQuestions = new Set();
let selectedAnswers = {};
let attemptStarted = false;
let timerSeconds = 0;
let timerInterval = null;
let markCorrect = 1;
let markWrong = 0;

// Phase 4 — MCQ Bank / Add MCQs
let mcqApiData = { nodes: [], mcqs: [] };
let mcqStudyData = { subjects: [] };
let currentMcqTopic = null;
let mcqTagSuggestions = [];

// PHASE 8a — Index_Terms loaded once via loadStudyTree()'s full dump
// (doGet already returns index_terms; no new endpoint needed).
let mcqIndexTerms = [];

// PHASE 8a — fixed, ordered language list: English + India's 22
// Eighth Schedule languages. `value` is what's stored / written into
// @language: tags (and what the practice-UI filter matches on);
// `label` is the native-script display text shown in the dropdown.
const MCQ_LANGUAGES = [
    { value: "English",   label: "English" },
    { value: "Assamese",  label: "Assamese (অসমীয়া)" },
    { value: "Bengali",   label: "Bengali (বাংলা)" },
    { value: "Bodo",      label: "Bodo (बड़ो)" },
    { value: "Dogri",     label: "Dogri (डोगरी)" },
    { value: "Gujarati",  label: "Gujarati (ગુજરાતી)" },
    { value: "Hindi",     label: "Hindi (हिंदी)" },
    { value: "Kannada",   label: "Kannada (ಕನ್ನಡ)" },
    { value: "Kashmiri",  label: "Kashmiri (کٲشُر)" },
    { value: "Konkani",   label: "Konkani (कोंकणी)" },
    { value: "Maithili",  label: "Maithili (मैथिली)" },
    { value: "Malayalam", label: "Malayalam (മലയാളം)" },
    { value: "Manipuri",  label: "Manipuri (মৈতৈলোন্)" },
    { value: "Marathi",   label: "Marathi (मराठी)" },
    { value: "Nepali",    label: "Nepali (नेपाली)" },
    { value: "Odia",      label: "Odia (ଓଡ଼ିଆ)" },
    { value: "Punjabi",   label: "Punjabi (ਪੰਜਾਬੀ)" },
    { value: "Sanskrit",  label: "Sanskrit (संस्कृतम्)" },
    { value: "Santali",   label: "Santali (ᱥᱟᱱᱛᱟᱲᱤ)" },
    { value: "Sindhi",    label: "Sindhi (سنڌي)" },
    { value: "Tamil",     label: "Tamil (தமிழ்)" },
    { value: "Telugu",    label: "Telugu (తెలుగు)" },
    { value: "Urdu",      label: "Urdu (اردو)" }
];

// Phase 7 — practice filters over the currently fetched question set.
let allLoadedMcqs = [];
let selectedMcqTags = new Set();
let selectedMcqLanguage = "";
let currentCollectionView = null;
let mcqPreviewRows = [];

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const GOOGLE_SHEET_API =
    "https://script.google.com/macros/s/AKfycbzE7zuqKXMmvfoP6LNCRw159odJsqWW9O0hEWm7uHIelnQJz4x7iFMnbTDKvm8lpIw5QA/exec";


// PHASE 5/7 — tree/breadcrumb structure only. MCQs are fetched lazily
// through get_mcqs(); the default doGet response no longer contains them.
async function loadStudyTree() {

    const response = await fetch(GOOGLE_SHEET_API);

    if (!response.ok) {
        throw new Error(
            `Google Sheet API failed (${response.status})`
        );
    }

    const apiData = await response.json();

    console.log("MCQ: Google Sheets data loaded:", apiData);

    // PHASE 8a — Index_Terms is already part of this same full dump
    // (doGet's default response); reuse it directly for the MCQ
    // popup's tag autocomplete instead of adding a new endpoint.
    mcqIndexTerms = apiData.index_terms || [];

    return convertApiDataToMcqData(apiData);
}

// PHASE 5 — lazy fetch of just the MCQs (+ referenced passages /
// collections) for one topic, via the new get_mcqs doGet action.
// Pass null/undefined for topicId to fetch with no node_id filter.
// Populates mcqApiData / mcqTagSuggestions as a side effect, same as
// the old full-dump load used to, but scoped to whatever was fetched.
async function loadMcqsForTopic(topicId) {

    const url = GOOGLE_SHEET_API + "?action=get_mcqs" +
        (topicId ? "&node_id=" + encodeURIComponent(topicId) : "");

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `Google Sheet API (get_mcqs) failed (${response.status})`
        );
    }

    const data = await response.json();

    mcqApiData = data || { mcqs: [], passages: [], collections: [] };
    const visibleRows = (mcqApiData.mcqs || []).filter(row =>
        String(row.status || "").trim().toLowerCase() !== "archived"
    );
    mcqTagSuggestions = buildMcqTagSuggestions(visibleRows);

    return visibleRows.map(mapMcqRow);
}

// Row -> practice-view MCQ object. Extracted out of the old
// "Attach MCQs" loop so both loadMcqsForTopic() and the refresh path
// in confirmSaveMcqs() share one mapping.
function mapMcqRow(row) {

    const correctOption = String(row.correct_option || "")
        .trim()
        .toUpperCase();

    const correctIndex = {
        A: 0,
        B: 1,
        C: 2,
        D: 3
    }[correctOption];

    return {
        id: row.mcq_id,
        question: row.question || "",
        options: [
            row.option_a || "",
            row.option_b || "",
            row.option_c || "",
            row.option_d || ""
        ],
        answer: correctIndex ?? 0,
        explanation: row.explanation || "",
        tags: row.tags || "",
        language: row.language || "",
        description: row.description || "",
        difficulty: row.difficulty || "",
        status: row.status || "",
        question_type: row.question_type || "simple",
        collection_id_ref: row.collection_id_ref || row.collection_id || "",
        collection_id: row.collection_id || "",
        question_no: row.question_no ?? "",
        node_id: row.node_id || "",
        warnings: row.warnings || []
    };
}


function convertApiDataToMcqData(apiData) {

    const nodes = apiData.nodes || [];

    const nodeMap = {};

    // Create nodes
    nodes.forEach(row => {

        nodeMap[row.node_id] = {
            id: row.node_id,
            title: row.title,
            type: row.node_type,
            parentId: row.parent_id || null,
            children: []
        };
    });


    // Build hierarchy
    nodes.forEach(row => {

        const node = nodeMap[row.node_id];

        if (!node) return;

        if (row.parent_id && nodeMap[row.parent_id]) {
            nodeMap[row.parent_id].children.push(node);
        }
    });


    // Return the same structure expected by existing mcq.js
    const subjects = nodes
        .filter(row =>
            row.node_type === "subject" &&
            !row.parent_id
        )
        .sort((a, b) =>
            Number(a.sort_order || 0) -
            Number(b.sort_order || 0)
        )
        .map(row => nodeMap[row.node_id]);

    return {
        subjects: subjects
    };
}

function findTopic(nodes, id) {
    for (const node of nodes || []) {
        if (node.id === id) return node;

        const found = findTopic(node.children, id);
        if (found) return found;
    }
    return null;
}

function findFirstTopic(nodes) {
    for (const node of nodes || []) {
        if (node.type === "topic") return node;

        const found = findFirstTopic(node.children);
        if (found) return found;
    }
    return null;
}

function resetAttemptState() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerSeconds = 0;
    attemptStarted = false;
    attemptedQuestions = new Set();
    selectedAnswers = {};

    const display = document.getElementById("mcq-timer-display");
    if (display) display.textContent = "No timer";
}

function startAttempt() {
    markCorrect = Number(document.getElementById("mark-correct").value) || 0;
    markWrong = Number(document.getElementById("mark-wrong").value) || 0;

    const mode = document.getElementById("mcq-timer-mode").value;

    clearInterval(timerInterval);
    attemptStarted = true;

    if (mode === "none") {
        document.getElementById("mcq-timer-display").textContent = "No timer";
        return;
    }

    timerSeconds = Number(mode) * 60;
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timerSeconds--;
        updateTimerDisplay();

        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            attemptStarted = false;
            document.getElementById("mcq-timer-display").textContent = "Time up";
        }
    }, 1000);
}

function updateTimerDisplay() {
    const display = document.getElementById("mcq-timer-display");
    if (!display) return;

    const minutes = Math.floor(timerSeconds / 60);
    const seconds = timerSeconds % 60;

    display.textContent =
        `${String(minutes).padStart(2, "0")}:` +
        `${String(seconds).padStart(2, "0")}`;
}


function getMcqLanguages(rows) {
    return Array.from(new Set((rows || []).map(mcq => String(mcq.language || "").trim()).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getMcqTags(rows) {
    return buildMcqTagSuggestions((rows || []).map(mcq => ({ tags: mcq.tags || "" })));
}

function getMcqCollectionInfo(collectionId) {
    return (mcqApiData.collections || []).find(c => String(c.collection_id || "") === String(collectionId || "")) || null;
}

function populateMcqPracticeFilters() {
    const language = document.getElementById("mcq-language");
    const languageWrap = document.querySelector(".mcq-language-control");
    const languages = getMcqLanguages(allLoadedMcqs);

    if (language) {
        language.innerHTML = languages.map(value =>
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
        ).join("");
        selectedMcqLanguage = languages.length > 1 && languages.includes(selectedMcqLanguage)
            ? selectedMcqLanguage
            : (languages.length > 1 ? "" : (languages[0] || ""));
        language.value = selectedMcqLanguage;
        if (languageWrap) languageWrap.hidden = languages.length <= 1;
    }

    const row = document.getElementById("mcq-tag-filter-row");
    if (!row) return;
    const tags = getMcqTags(allLoadedMcqs);
    const previous = selectedMcqTags;
    selectedMcqTags = new Set(Array.from(previous).filter(tag => tags.includes(tag)));
    row.innerHTML = tags.length ? tags.map(tag => `
        <button type="button" class="mcq-filter-chip ${selectedMcqTags.has(tag) ? "active" : ""}" data-tag="${escapeHtml(tag)}">
            ${escapeHtml(tag)}
        </button>
    `).join("") : `<span class="mcq-filter-empty">No tags in this topic</span>`;

    row.querySelectorAll(".mcq-filter-chip").forEach(button => {
        button.addEventListener("click", () => {
            const tag = button.dataset.tag || "";
            if (selectedMcqTags.has(tag)) selectedMcqTags.delete(tag);
            else selectedMcqTags.add(tag);
            applyMcqPracticeFilters();
        });
    });
}

function renderMcqCollectionNotes() {
    const host = document.getElementById("mcq-collection-notes");
    if (!host) return;
    if (currentCollectionView) {
        const info = getMcqCollectionInfo(currentCollectionView.id);
        host.innerHTML = `<div class="mcq-collection-note">
            <strong>Full paper:</strong> ${escapeHtml(info?.title || currentCollectionView.id)}
            <button type="button" id="mcq-back-to-topic" class="mcq-collection-link">Back to topic</button>
        </div>`;
        document.getElementById("mcq-back-to-topic")?.addEventListener("click", () => {
            currentCollectionView = null;
            selectedMcqTags = new Set();
            selectedMcqLanguage = "";
            allLoadedMcqs = currentCollectionViewBackup.slice();
            mcqApiData = currentCollectionViewApiBackup;
            populateMcqPracticeFilters();
            applyMcqPracticeFilters();
        });
        return;
    }

    const counts = new Map();
    allLoadedMcqs.forEach(mcq => {
        const id = String(mcq.collection_id_ref || "").trim();
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    const shared = Array.from(counts.entries()).filter(([, count]) => count > 1);
    host.innerHTML = shared.map(([id]) => {
        const info = getMcqCollectionInfo(id);
        return `<div class="mcq-collection-note">
            This topic includes questions from: <strong>${escapeHtml(info?.title || id)}</strong>
            <button type="button" class="mcq-collection-link" data-collection-id="${escapeHtml(id)}">View full paper in order</button>
        </div>`;
    }).join("");
    host.querySelectorAll("[data-collection-id]").forEach(button => {
        button.addEventListener("click", () => loadFullMcqCollection(button.dataset.collectionId));
    });
}

let currentCollectionViewBackup = [];
let currentCollectionViewApiBackup = null;

async function loadFullMcqCollection(collectionId) {
    if (!collectionId) return;
    try {
        currentCollectionViewBackup = allLoadedMcqs.slice();
        currentCollectionViewApiBackup = mcqApiData;
        const response = await fetch(GOOGLE_SHEET_API + "?action=get_mcqs&collection_id=" + encodeURIComponent(collectionId));
        if (!response.ok) throw new Error(`Collection fetch failed (${response.status})`);
        const data = await response.json();
        mcqApiData = data || { mcqs: [], passages: [], collections: [] };
        const rows = (mcqApiData.mcqs || []).filter(row => String(row.status || "").trim().toLowerCase() !== "archived");
        allLoadedMcqs = rows.map(mapMcqRow).sort((a, b) => {
            const qa = Number(a.question_no || 0), qb = Number(b.question_no || 0);
            return (qa || Number.MAX_SAFE_INTEGER) - (qb || Number.MAX_SAFE_INTEGER);
        });
        currentCollectionView = { id: collectionId };
        selectedMcqTags = new Set();
        selectedMcqLanguage = "";
        populateMcqPracticeFilters();
        applyMcqPracticeFilters();
    } catch (error) {
        console.error("Could not load full MCQ collection:", error);
        alert("Could not load the full paper. Please try again.");
    }
}

function applyMcqPracticeFilters() {
    let filtered = allLoadedMcqs.slice();
    if (selectedMcqLanguage) {
        filtered = filtered.filter(mcq => String(mcq.language || "").trim().toLowerCase() === selectedMcqLanguage.trim().toLowerCase());
    }
    if (selectedMcqTags.size) {
        filtered = filtered.filter(mcq => {
            const tags = new Set(String(mcq.tags || "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean));
            return Array.from(selectedMcqTags).every(tag => tags.has(tag.toLowerCase()));
        });
    }
    currentMcqs = filtered;
    currentMcqIndex = Math.min(currentMcqIndex, Math.max(0, currentMcqs.length - 1));
    resetAttemptState();
    populateMcqPracticeFilters();
    renderMcqCollectionNotes();
    renderMcqView();
}

function renderMcqView() {
    const questionArea = document.getElementById("mcq-question");
    const grid = document.getElementById("mcq-question-grid");

    if (!currentMcqs.length) {
        questionArea.innerHTML = "<p>No MCQs added for this topic yet.</p>";
        grid.innerHTML = "";
        return;
    }

    const totalLabel = document.getElementById("mcq-nav-total");
    if (totalLabel) totalLabel.textContent = currentMcqs.length;

    grid.innerHTML = currentMcqs.map((mcq, index) => `
        <button
            type="button"
            class="mcq-number ${
                attemptedQuestions.has(index) ? "attempted" : ""
            } ${
                index === currentMcqIndex ? "current" : ""
            }"
            data-question-index="${index}"
        >${index + 1}</button>
    `).join("");

    grid.querySelectorAll(".mcq-number").forEach(button => {
        button.addEventListener("click", () => {
            currentMcqIndex = Number(button.dataset.questionIndex);
            renderMcqView();
        });
    });

    const mcq = currentMcqs[currentMcqIndex];
    const selected = selectedAnswers[currentMcqIndex];

    questionArea.innerHTML = `
        <div class="mcq-card-large">
            <div class="mcq-question-number mcq-question-heading">
                <span>Question ${currentMcqIndex + 1} of ${currentMcqs.length}</span>
                <button type="button" class="mcq-edit-meta" id="mcq-edit-meta" title="Edit question metadata" aria-label="Edit question metadata">✏️</button>
            </div>

            <div class="mcq-question-text">
                ${escapeHtml(mcq.question)}
            </div>

            <div class="mcq-large-options">
                ${mcq.options.map((option, index) => `
                    <button
                        type="button"
                        class="mcq-large-option ${
                            selected === index ? "selected" : ""
                        }"
                        data-option-index="${index}"
                    >
                        ${escapeHtml(option)}
                    </button>
                `).join("")}
            </div>

            <div id="mcq-feedback" class="mcq-feedback" hidden></div>

            <div class="mcq-navigation-buttons">
                <button id="mcq-prev" type="button">← Previous</button>
                <button id="mcq-next" type="button">Next →</button>
            </div>
        </div>
    `;

    questionArea.querySelectorAll(".mcq-large-option")
        .forEach(button => {
            button.addEventListener("click", () => {
                answerCurrentQuestion(Number(button.dataset.optionIndex));
            });
        });

    document.getElementById("mcq-edit-meta")?.addEventListener("click", () => {
        openMcqMetaModal(mcq);
    });

    document.getElementById("mcq-prev").addEventListener("click", () => {
        if (currentMcqIndex > 0) {
            currentMcqIndex--;
            renderMcqView();
        }
    });

    document.getElementById("mcq-next").addEventListener("click", () => {
        if (currentMcqIndex < currentMcqs.length - 1) {
            currentMcqIndex++;
            renderMcqView();
        }
    });
}

function answerCurrentQuestion(optionIndex) {
    const feedback = document.getElementById("mcq-feedback");

    if (!attemptStarted) {
        feedback.hidden = false;
        feedback.textContent =
            "Click Start Attempt before answering questions.";
        return;
    }

    const mcq = currentMcqs[currentMcqIndex];

    selectedAnswers[currentMcqIndex] = optionIndex;
    attemptedQuestions.add(currentMcqIndex);

    renderMcqView();

    const newFeedback = document.getElementById("mcq-feedback");
    const correct = optionIndex === mcq.answer;

    newFeedback.hidden = false;
    newFeedback.innerHTML =
        `<strong>${correct ? "Correct" : "Not correct"}</strong><br>` +
        escapeHtml(mcq.explanation);
}

document.getElementById("mcq-start").addEventListener("click", startAttempt);

document.getElementById("mcq-nav-toggle")?.addEventListener("click", () => {
    const navigator = document.getElementById("mcq-navigator");
    if (!navigator) return;

    navigator.classList.toggle("collapsed");

    const workspace = document.querySelector(".mcq-workspace");
    const button = document.getElementById("mcq-nav-toggle");
    const collapsed = navigator.classList.contains("collapsed");

    if (workspace) {
        workspace.classList.toggle("navigator-collapsed", collapsed);
    }

    button.textContent = collapsed ? "‹" : "›";
    button.title = collapsed
        ? "Expand question navigator"
        : "Collapse question navigator";
});



function calculateResult() {
    let correct = 0, wrong = 0, unanswered = 0, score = 0;

    currentMcqs.forEach((mcq, index) => {
        if (!(index in selectedAnswers)) {
            unanswered++;
        } else if (selectedAnswers[index] === mcq.answer) {
            correct++;
            score += markCorrect;
        } else {
            wrong++;
            score += markWrong;
        }
    });

    return { total: currentMcqs.length, correct, wrong, unanswered, score };
}

function showResult() {
    clearInterval(timerInterval);
    timerInterval = null;
    attemptStarted = false;

    const result = calculateResult();
    document.getElementById("result-summary").innerHTML = `
        <div class="result-stat"><div class="result-stat-label">Score</div><div class="result-stat-value">${result.score}</div></div>
        <div class="result-stat"><div class="result-stat-label">Correct</div><div class="result-stat-value">${result.correct}</div></div>
        <div class="result-stat"><div class="result-stat-label">Wrong</div><div class="result-stat-value">${result.wrong}</div></div>
        <div class="result-stat"><div class="result-stat-label">Unanswered</div><div class="result-stat-value">${result.unanswered}</div></div>
    `;

    document.getElementById("result-details").innerHTML =
        currentMcqs.map((mcq, index) => {
            const selected = selectedAnswers[index];

            if (selected === undefined) {
                return `<div class="result-question">
                    <strong>Q${index + 1} — Unanswered</strong><br>
                    ${escapeHtml(mcq.question)}
                </div>`;
            }

            const isCorrect = selected === mcq.answer;

            return `<div class="result-question ${isCorrect ? "correct" : "wrong"}">
                <strong>Q${index + 1} — ${isCorrect ? "Correct" : "Wrong"}</strong><br>
                ${escapeHtml(mcq.question)}<br><br>
                Your answer: ${escapeHtml(mcq.options[selected])}<br>
                Correct answer: ${escapeHtml(mcq.options[mcq.answer])}<br><br>
                ${escapeHtml(mcq.explanation)}
            </div>`;
        }).join("");

    document.getElementById("mcq-result").hidden = false;

    if (!document.getElementById("download-report")) {
        const retry = document.getElementById("mcq-retry");
        const button = document.createElement("button");
        button.id = "download-report";
        button.type = "button";
        button.textContent = "Download Report PDF";
        button.addEventListener("click", downloadReport);
        retry.insertAdjacentElement("beforebegin", button);
    }
}


function buildPrintableReport() {
    const result = calculateResult();

    const rows = currentMcqs.map((mcq, index) => {
        const selected = selectedAnswers[index];
        const status = selected === undefined
            ? "Unanswered"
            : selected === mcq.answer
                ? "Correct"
                : "Wrong";

        return `
            <article class="print-question ${status.toLowerCase()}">
                <h3>Q${index + 1}. ${escapeHtml(mcq.question)}</h3>
                <p><strong>Status:</strong> ${status}</p>
                <p><strong>Your answer:</strong>
                    ${selected === undefined
                        ? "Not attempted"
                        : escapeHtml(mcq.options[selected])}
                </p>
                <p><strong>Correct answer:</strong>
                    ${escapeHtml(mcq.options[mcq.answer])}
                </p>
                <p><strong>Explanation:</strong>
                    ${escapeHtml(mcq.explanation)}
                </p>
            </article>
        `;
    }).join("");

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>MCQ Attempt Report</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    color: #26332b;
                    margin: 40px;
                    line-height: 1.5;
                }
                h1 { margin-bottom: 5px; }
                .meta { color: #667168; margin-bottom: 25px; }
                .summary {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 10px;
                    margin: 20px 0 30px;
                }
                .stat {
                    border: 1px solid #ccd4cc;
                    padding: 12px;
                }
                .label { font-size: 11px; color: #68736c; }
                .value { font-size: 20px; font-weight: bold; }
                .print-question {
                    border-top: 1px solid #d5dbd5;
                    padding: 16px 0;
                    break-inside: avoid;
                }
                .print-question.correct {
                    border-left: 4px solid #8eab96;
                    padding-left: 12px;
                }
                .print-question.wrong {
                    border-left: 4px solid #c5a0a0;
                    padding-left: 12px;
                }
                .print-question.unanswered {
                    border-left: 4px solid #c9c9b5;
                    padding-left: 12px;
                }
                @media print {
                    body { margin: 20mm; }
                }
            </style>
        </head>
        <body>
            <h1>MCQ Attempt Report</h1>
            <div class="meta">
                Generated locally from the current attempt.
            </div>

            <div class="summary">
                <div class="stat">
                    <div class="label">Score</div>
                    <div class="value">${result.score}</div>
                </div>
                <div class="stat">
                    <div class="label">Correct</div>
                    <div class="value">${result.correct}</div>
                </div>
                <div class="stat">
                    <div class="label">Wrong</div>
                    <div class="value">${result.wrong}</div>
                </div>
                <div class="stat">
                    <div class="label">Unanswered</div>
                    <div class="value">${result.unanswered}</div>
                </div>
            </div>

            ${rows}
        </body>
        </html>
    `;
}

function downloadReport() {
    const printable = buildPrintableReport();
    const reportWindow = window.open("", "_blank");

    if (!reportWindow) {
        alert("Please allow pop-ups for the report window.");
        return;
    }

    reportWindow.document.open();
    reportWindow.document.write(printable);
    reportWindow.document.close();

    reportWindow.onload = () => {
        reportWindow.focus();
        reportWindow.print();
    };
}

function resetForNewAttempt() {
    document.getElementById("mcq-result").hidden = true;
    currentMcqIndex = 0;
    resetAttemptState();
    renderMcqView();
}

document.getElementById("mcq-submit").addEventListener("click", showResult);
document.getElementById("mcq-retry").addEventListener("click", resetForNewAttempt);

async function init() {
    try {
        const data = await loadStudyTree();
        mcqStudyData = data;

        const params = new URLSearchParams(window.location.search);
        const topicId = params.get("topic");

        // Resolve which topic to show first (URL param, else first
        // topic in the tree — same fallback as before). Either way we
        // now fetch that topic's MCQs lazily via get_mcqs, instead of
        // reading them out of the already-fetched full dump.
        const topic = topicId
            ? findTopic(data.subjects, topicId)
            : findFirstTopic(data.subjects);

        currentMcqTopic = topic || null;
        allLoadedMcqs = topic ? await loadMcqsForTopic(topic.id) : [];
        currentCollectionView = null;
        selectedMcqTags = new Set();
        selectedMcqLanguage = "";
        populateMcqPracticeFilters();
        currentMcqs = allLoadedMcqs.slice();
        renderMcqCollectionNotes();
        resetAttemptState();
        renderMcqView();

        if (topic) {
            document.title = `${topic.title} — MCQ Practice`;
        }
    } catch (error) {
        console.error(error);
        document.getElementById("mcq-question").innerHTML =
            "<p>Could not load MCQ data.</p>";
    }
}

init();

/* STEP 34 — MCQ DISPLAY CONTROLS */
(() => {
    const root = document.querySelector(".mcq-page");
    const down = document.getElementById("mcq-font-down");
    const up = document.getElementById("mcq-font-up");
    const lang = document.getElementById("mcq-language");
    if (!root) return;

    let size = Number(localStorage.getItem("alpha_mcq_font_size") || "1");
    size = Math.max(0.85, Math.min(1.35, size));

    function applySize() {
        root.style.setProperty("--mcq-font-scale", size);
        localStorage.setItem("alpha_mcq_font_size", String(size));
    }

    down?.addEventListener("click", () => {
        size = Math.max(0.85, +(size - 0.1).toFixed(2));
        applySize();
    });

    up?.addEventListener("click", () => {
        size = Math.min(1.35, +(size + 0.1).toFixed(2));
        applySize();
    });

    lang?.addEventListener("change", () => {
        selectedMcqLanguage = lang.value || "";
        applyMcqPracticeFilters();
    });

    applySize();
})();

/* =========================================================
   PHASE 4 — MCQ BANK: Add MCQs + Fetch & Preview
   Reuses the site's existing modal/button classes; no new modal
   framework is introduced here.
   ========================================================= */

const MCQ_TYPE_PROMPT_BLOCKS = {
    simple: `SIMPLE MCQ FORMAT
For each simple MCQ, use:
@type: simple
@topic: <node_id>
@question: <question text>
@options:
A) <option A>
B) <option B>
C) <option C>
D) <option D>
@correct: A|B|C|D
@explanation: <brief explanation>
@end`,

    assertion_reason: `ASSERTION–REASONING FORMAT
For each assertion–reasoning MCQ, use:
@type: assertion_reason
@topic: <node_id>
@assertion: <Assertion (A)>
@reason: <Reason (R)>
@correct: A|B|C|D
@explanation: <brief explanation>
@end
The parser supplies the standard A–D Assertion–Reasoning options automatically, so do not invent replacement option text unless specifically required.`,

    comprehension: `COMPREHENSION FORMAT
For a comprehension set, put the passage before its questions:
@passage: p001
@topic: <node_id>
@passage_kind: text
@passage_text:
<verbatim passage>
@end_passage

Then create each question as a normal question block and reference that passage:
@type: simple
@topic: <node_id>
@passage: p001
@question: <question based on the passage>
@options:
A) <option A>
B) <option B>
C) <option C>
D) <option D>
@correct: A|B|C|D
@explanation: <brief explanation>
@end`,

    table: `TABLE / DI FORMAT
When a question depends on a table or data interpretation, keep the table/data inside the question or passage as Markdown text and then use:
@type: simple
@topic: <node_id>
@question:
<question and any required table/data>
@options:
A) <option A>
B) <option B>
C) <option C>
D) <option D>
@correct: A|B|C|D
@explanation: <brief calculation/reasoning>
@end`
};

function mcqEscapeHtml(value) {
    return escapeHtml(value == null ? "" : value);
}

function buildMcqTagSuggestions(rows) {
    const set = new Set();
    (rows || []).forEach(row => {
        String(row.tags || "").split(",").forEach(tag => {
            const clean = tag.trim();
            if (clean) set.add(clean);
        });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function getMcqNodePath(nodeId) {
    const path = [];
    function walk(nodes) {
        for (const node of nodes || []) {
            path.push(node);
            if (node.id === nodeId) return true;
            if (walk(node.children)) return true;
            path.pop();
        }
        return false;
    }
    return walk(mcqStudyData.subjects) ? path.slice() : [];
}

function buildMcqTopicBreadcrumb(node) {
    return getMcqNodePath(node?.id).map(n => n.title).join(" → ");
}

function buildMcqSuggestedFileName(node) {
    const labels = {
        subject: "Sub",
        course: "Course",
        unit: "Unit",
        chapter: "Chapter",
        topic: "Topic",
        subtopic: "Subtopic"
    };
    return getMcqNodePath(node?.id).map(n => {
        const label = labels[n.type] || (n.type ? n.type.charAt(0).toUpperCase() + n.type.slice(1) : "Node");
        const safe = String(n.title || "").trim().replace(/\s+/g, "-");
        return `${label}_${safe}`;
    }).join("_") + ".md";
}

function flattenMcqTopics(nodes, depth = 0, out = []) {
    (nodes || []).forEach(node => {
        out.push({ node, depth });
        flattenMcqTopics(node.children, depth + 1, out);
    });
    return out;
}

function getMcqSelectedTypes() {
    return Array.from(document.querySelectorAll('#mcq-type-options input[type="checkbox"]:checked'))
        .map(input => input.value);
}

/* =========================================================
   PHASE 8a — multi-language generator for the Add MCQ popup.
   Replaces the old single free-typeable "Language" text input.
   ========================================================= */

function mcqLanguageOptionsHtml(selectedValue) {
    return `<option value="">Select...</option>` + MCQ_LANGUAGES.map(lang =>
        `<option value="${mcqEscapeHtml(lang.value)}" ${lang.value === selectedValue ? "selected" : ""}>${mcqEscapeHtml(lang.label)}</option>`
    ).join("");
}

// Renders exactly `count` <select> rows into #mcq-lang-select-row.
// Preserves existing selections where possible: 2->3 keeps the first
// two and adds an empty third; 3->2 drops the third.
function renderMcqLanguageSelects(count) {
    const wrap = document.getElementById("mcq-lang-select-row");
    if (!wrap) return;

    const existingValues = Array.from(wrap.querySelectorAll(".mcq-lang-select")).map(s => s.value);
    const n = Math.max(1, Math.min(23, Number(count) || 1));

    wrap.innerHTML = "";
    for (let i = 0; i < n; i++) {
        const select = document.createElement("select");
        select.className = "mcq-lang-select";
        select.innerHTML = mcqLanguageOptionsHtml(existingValues[i] || (i === 0 ? "English" : ""));
        select.addEventListener("change", refreshLanguageDropdownOptions);
        wrap.appendChild(select);
    }

    refreshLanguageDropdownOptions();
}

// No-duplicate rule: after any dropdown's selection changes, disable
// that value's <option> in every OTHER dropdown (never in the
// dropdown that currently holds it).
function refreshLanguageDropdownOptions() {
    const selects = Array.from(document.querySelectorAll(".mcq-lang-select"));
    const chosen = selects.map(s => s.value).filter(Boolean);
    selects.forEach(select => {
        Array.from(select.options).forEach(opt => {
            if (!opt.value) return; // skip placeholder "Select..." option
            const chosenElsewhere = chosen.includes(opt.value) && select.value !== opt.value;
            opt.disabled = chosenElsewhere;
        });
    });
}

// Ordered list of selected language values (skips empty/placeholder
// dropdowns), in the order the dropdowns appear on screen.
function getMcqSelectedLanguages() {
    return Array.from(document.querySelectorAll(".mcq-lang-select"))
        .map(s => s.value)
        .filter(Boolean);
}

function getMcqTagChips() {
    return Array.from(document.querySelectorAll("#mcq-tag-chips .mcq-tag-chip"))
        .map(chip => chip.dataset.tag || "")
        .filter(Boolean);
}

function addMcqTagChip(value) {
    const clean = String(value || "").trim().replace(/^,+|,+$/g, "");
    if (!clean) return;
    const existing = getMcqTagChips();
    if (existing.some(tag => tag.toLowerCase() === clean.toLowerCase())) return;

    const wrap = document.getElementById("mcq-tag-chips");
    if (!wrap) return;
    const chip = document.createElement("span");
    chip.className = "mcq-tag-chip";
    chip.dataset.tag = clean;
    chip.innerHTML = `${mcqEscapeHtml(clean)} <button type="button" aria-label="Remove tag">×</button>`;
    chip.querySelector("button").addEventListener("click", () => chip.remove());
    wrap.appendChild(chip);
}

// PHASE 8a — tag suggestions now come only from the canonical
// Index_Terms list (term / normalized_term), not from MCQs' own
// free-typed `tags` column. No "create new tag" path exists here
// any more — if a match isn't in the Index yet, the user adds it via
// the Index system's own UI first, or uses the Description field.
function getMcqIndexTermSuggestions(query) {
    const q = String(query || "").trim().toLowerCase();
    return (mcqIndexTerms || [])
        .map(row => String(row.term || "").trim())
        .filter(Boolean)
        .filter(term => !q || term.toLowerCase().includes(q) ||
            String(mcqIndexTerms.find(r => r.term === term)?.normalized_term || "").includes(q))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function renderMcqTagSuggestions(value) {
    const box = document.getElementById("mcq-tag-suggestions");
    if (!box) return;
    const q = String(value || "").trim().toLowerCase();
    const matches = getMcqIndexTermSuggestions(q)
        .filter(tag => !getMcqTagChips().some(x => x.toLowerCase() === tag.toLowerCase()))
        .slice(0, 8);

    box.innerHTML = matches.map(tag =>
        `<button type="button" data-tag="${mcqEscapeHtml(tag)}">${mcqEscapeHtml(tag)}</button>`
    ).join("");
    box.hidden = matches.length === 0;
    box.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
            addMcqTagChip(btn.dataset.tag);
            const input = document.getElementById("mcq-tag-input");
            if (input) {
                input.value = "";
                input.focus();
            }
            renderMcqTagSuggestions("");
        });
    });
}

function buildMcqAiPrompt() {
    const collection = document.getElementById("mcq-collection")?.value.trim() || "";
    const description = document.getElementById("mcq-description")?.value.trim() || "";
    const languages = getMcqSelectedLanguages(); // PHASE 8a — ordered list of selected language values
    const topic = currentMcqTopic;
    const topicId = topic?.id || "<PUT TOPIC ID HERE>";
    const breadcrumb = buildMcqTopicBreadcrumb(topic) || "<PUT HIERARCHY PATH HERE>";
    const filename = document.getElementById("mcq-suggested-filename")?.value.trim() ||
        buildMcqSuggestedFileName(topic);
    const tags = getMcqTagChips();
    const types = getMcqSelectedTypes();
    const count = document.getElementById("mcq-question-count")?.value || "10";
    const includeMath = document.getElementById("mcq-include-math")?.checked;

    const blocks = types.length
        ? types.map(type => MCQ_TYPE_PROMPT_BLOCKS[type]).join("\n\n---\n\n")
        : "Choose at least one question type in the popup. Do not generate other question types.";

    const lines = [
        "You are helping me create a structured Markdown (.md) file for the MCQ Bank of a Library & Information Science exam-prep website.",
        "",
        "Use ONLY the tag grammar below. Do not invent alternative metadata syntax.",
        "",
        `Study Topic hierarchy: ${breadcrumb}`,
        `Study Topic ID: ${topicId}`,
        `Generate approximately ${count} questions.`,
        "",
        "QUESTION TYPE INSTRUCTIONS",
        blocks
    ];

    if (includeMath) {
        lines.push("", "MATH / NUMERIC-HEAVY INSTRUCTION", 
            "Include math or numeric-heavy questions where relevant. Preserve equations, calculations, units, percentages, ratios, tables, and numerical data accurately. Do not replace a required calculation with a vague conceptual question.");
    }

    // PHASE 8a — N=1 keeps the old single-@collection instruction;
    // N>=2 replaces it with a per-language-block instruction so the
    // AI generates the same question set once per selected language.
    if (languages.length >= 2) {
        const countWord = languages.length === 2 ? "TWICE" : (languages.length + " TIMES");
        const blockCollectionName = lang => collection ? `${collection} (${lang})` : `(${lang})`;
        const blockText = languages.map((lang, i) => {
            const intro = i === 0 ? `Start the ${lang} block with:` : `Then start the ${lang} block with:`;
            const closing = i === 0
                ? `...then all ${lang} questions...`
                : `...then all ${lang} questions in the same order and meaning as the ${languages[i - 1]} block.`;
            return `${intro}\n@collection: ${blockCollectionName(lang)}\n${closing}`;
        }).join("\n");

        lines.push("", "MULTI-LANGUAGE INSTRUCTION",
            `Generate this exact set of questions ${countWord}, once fully in each of the following languages, in this exact order, so that question N in one block corresponds exactly to question N in every other block: ${languages.join(", then ")}.`,
            blockText,
            "Each new @collection line above starts a fresh sequential question_no count for that block only (do not repeat it mid-block).");
    } else if (collection) {
        lines.push("", `@collection: ${collection}`,
            "Put this @collection line on the FIRST question of this collection only. It carries forward to subsequent questions; do not repeat it on every question.");
    }

    if (languages.length === 1 && languages[0] && languages[0].toLowerCase() !== "english") {
        lines.push("", `Add @language: ${languages[0]} to EACH question.`);
    }

    if (tags.length) {
        lines.push("", `Add @tags: ${tags.join(", ")} to EACH question.`);
    }

    if (description) {
        lines.push("", `Use this description where appropriate: ${description}`);
    }

    lines.push("", 
        "GENERAL RULES",
        "- Every question must have @topic using the Study Topic ID above unless the source material explicitly requires a different, valid topic.",
        "- Every question must end with @end.",
        "- A genuinely required field must not be guessed. If source material does not support it, leave it out rather than fabricating it.",
        "- Keep question, option, correct answer, and explanation content faithful to the supplied source.",
        "",
        "---",
        "FILE NAMING INSTRUCTION (for you, the human — not for the AI tool):",
        "Once the AI has generated the MCQ Markdown file, save it to Google Drive using EXACTLY this file name:",
        "",
        filename,
        "",
        'Then set that file\'s sharing to "Anyone with the link can view", copy its share link, and paste that link into the Google Drive .md link box on the website.'
    );

    return lines.join("\n");
}

function copyMcqAiPrompt() {
    const prompt = buildMcqAiPrompt();
    const done = () => alert("MCQ prompt copied! Paste it into ChatGPT, Claude, Gemini, or another AI tool with your source material.");
    const manual = () => alert("Could not copy automatically — please copy the prompt manually:\n\n" + prompt);

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(prompt)
            .then(done)
            .catch(() => fallbackCopyText(prompt, done, manual));
    } else {
        fallbackCopyText(prompt, done, manual);
    }
}

// PHASE 5 — tag autocomplete used to be built from the full-dump's
// sitewide `mcqs` list; now that the practice view only loads the
// current topic's MCQs, refresh it with a sitewide (unfiltered)
// get_mcqs call, but only when the Add MCQ popup is actually opened
// — not on every page load. Fire-and-forget: the popup renders
// immediately either way, suggestions just fill in once this resolves.
function refreshSitewideMcqTagSuggestions() {
    fetch(GOOGLE_SHEET_API + "?action=get_mcqs")
        .then(response => response.ok ? response.json() : null)
        .then(data => {
            if (data && data.mcqs) {
                mcqTagSuggestions = buildMcqTagSuggestions(data.mcqs);
            }
        })
        .catch(error => console.warn("Tag suggestion refresh failed:", error));
}

// PHASE 8b — bilingual (English/हिन्दी) field guide shown in the
// popup's top-right "?" panel. Numbers/colors below match the
// numbered markers rendered next to each field in openAddMcqModal().
// "Include math" and "Tag format reference" have no field number of
// their own (math is part of point 8's row; the reference has
// nothing for the user to fill in), so they're folded into the
// neighbouring point's text instead of getting their own entry.
let mcqGuideActiveTab = "english"; // persists for the session only

// red = absolutely necessary, yellow = worth checking/adjusting,
// green = fine to leave as-is / fully optional. Point 2 (Collection
// name) is dynamic — its color is computed from the live field in
// mcqGuideColorClass() below, not from this static list.
const MCQ_GUIDE_COLORS = ["yellow", "red", "red", "green", "green", "green", "yellow", "red", "yellow", "green", "yellow", "red"];

const MCQ_GUIDE_POINTS = [
    { en: "Import mode — choose Full Set/Paper for a whole paper/collection, or Individual MCQ for a single question. This decides whether Collection name is required.",
      hi: "Import mode — पूरे paper/collection के लिए Full Set/Paper चुनें, या सिर्फ़ एक question के लिए Individual MCQ चुनें। इसी से तय होता है कि Collection name ज़रूरी है या नहीं।" },
    { en: "Collection name — required only in Full Set/Paper mode. Name the paper/set (e.g. 'SSC CGL 2023 Tier 1'). Leave blank in Individual MCQ mode.",
      hi: "Collection name — सिर्फ़ Full Set/Paper mode में ज़रूरी है। Paper या set का नाम डालें (जैसे 'SSC CGL 2023 Tier 1')। Individual MCQ mode में इसे खाली छोड़ सकते हैं।" },
    { en: "Google Drive .md link — required. Paste the share link of your Markdown file; it must be set to 'Anyone with the link can view'.",
      hi: "Google Drive .md link — ज़रूरी है। अपनी Markdown file का share link paste करें; उसे 'Anyone with the link can view' पर set होना चाहिए।" },
    { en: "Description — optional. A short note about this collection or MCQ, used only as extra context.",
      hi: "Description — optional है। इस collection या MCQ के बारे में एक छोटा सा note, सिर्फ़ extra context के लिए इस्तेमाल होता है।" },
    { en: "Tags — optional. Search and select existing terms from the Index; new tags can't be created from here.",
      hi: "Tags — optional हैं। Index में मौजूद terms को search करके select करें; यहाँ से नया tag नहीं बनाया जा सकता।" },
    { en: "Study Topic — optional. Pick the tree node these MCQs belong to; used to build the suggested file name.",
      hi: "Study Topic — optional है। उस tree node को चुनें जिससे ये MCQs related हैं; इसी से suggested file name बनता है।" },
    { en: "How many languages? — choose 1–23. Selecting more than one adds a Language dropdown for each, used to generate the same questions in every selected language.",
      hi: "How many languages? — 1 से 23 तक चुन सकते हैं। एक से ज़्यादा चुनने पर हर एक के लिए एक Language dropdown आ जाता है, जिससे same questions हर selected language में generate होते हैं।" },
    { en: "Question type(s) — select which types (Simple, Assertion–Reasoning, Comprehension, Table/DI) the AI prompt should ask for; at least one is required. The same row has an optional 'Include math' checkbox for calculation-heavy questions.",
      hi: "Question type(s) — तय करें कि AI prompt किस type (Simple, Assertion–Reasoning, Comprehension, Table/DI) के questions माँगे; कम से कम एक type चुनना ज़रूरी है। इसी row में एक optional 'Include math' checkbox भी है, calculation-heavy questions के लिए।" },
    { en: "How many questions? — sets the approximate question count the AI prompt asks for.",
      hi: "How many questions? — इससे AI prompt में लगभग कितने questions चाहिए, वो number set होता है।" },
    { en: "Copy AI Prompt — builds the full prompt from everything above and copies it, ready to paste into an AI tool.",
      hi: "Copy AI Prompt — ऊपर की सारी settings से पूरा prompt बनाकर copy कर देता है, जिसे किसी AI tool में paste किया जा सकता है।" },
    { en: "Suggested file name — auto-generated from the selected Study Topic; copy it and use it exactly when saving the .md file to Drive. (Below it is a collapsible 'Tag format reference' — nothing to fill in, just a cheat-sheet of the @tag grammar.)",
      hi: "Suggested file name — selected Study Topic से auto-generate होता है; .md file को Drive पर save करते समय इसी नाम का इस्तेमाल करें। (इसके ठीक ऊपर एक collapsible 'Tag format reference' है — उसमें कुछ भरना नहीं है, बस @tag grammar की cheat-sheet है।)" },
    { en: "Fetch & Preview — required. Fetches the Drive file, parses it, and opens a preview before anything is saved to the sheet.",
      hi: "Fetch & Preview — ज़रूरी step है। Drive file को fetch करके parse करता है, और sheet में save होने से पहले एक preview खोलता है।" }
];

// Point 2 (index 1, "Collection name") is dynamic — it mirrors
// whatever the popup's Full Set/Individual toggle currently has set,
// so the guide never disagrees with the actual field.
function mcqGuideColorClass(i) {
    if (i === 1) {
        const required = document.getElementById("mcq-collection")?.required;
        return required ? "red" : "green";
    }
    return MCQ_GUIDE_COLORS[i] || "green";
}

function renderMcqGuideList() {
    const list = document.getElementById("mcq-guide-list");
    if (!list) return;
    list.innerHTML = MCQ_GUIDE_POINTS.map((p, i) =>
        `<li><strong class="mcq-num-${mcqGuideColorClass(i)}">${i + 1}.</strong> ${mcqEscapeHtml(mcqGuideActiveTab === "hindi" ? p.hi : p.en)}</li>`
    ).join("");
    document.getElementById("mcq-guide-tab-en")?.classList.toggle("primary", mcqGuideActiveTab === "english");
    document.getElementById("mcq-guide-tab-hi")?.classList.toggle("primary", mcqGuideActiveTab === "hindi");
}

// Opens on top of the still-open Add MCQ popup without closing it;
// closes via its own × or an outside (overlay) click, returning
// focus to the guide icon in the popup underneath.
function openMcqGuideModal() {
    document.getElementById("mcq-guide-modal")?.remove();

    const modal = document.createElement("div");
    modal.id = "mcq-guide-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay" id="mcq-guide-overlay">
            <div class="add-resource-modal mcq-guide-modal">
                <button type="button" class="modal-close" id="mcq-guide-close">×</button>
                <h2>Field Guide</h2>
                <div class="resource-type-options" role="tablist" aria-label="Guide language">
                    <button type="button" id="mcq-guide-tab-en">English</button>
                    <button type="button" id="mcq-guide-tab-hi">हिन्दी</button>
                </div>
                <ol id="mcq-guide-list" class="mcq-guide-list"></ol>
            </div>
        </div>`;
    document.body.appendChild(modal);
    renderMcqGuideList();

    const closeGuide = () => {
        modal.remove();
        document.getElementById("mcq-guide-open")?.focus();
    };

    document.getElementById("mcq-guide-close").addEventListener("click", closeGuide);
    document.getElementById("mcq-guide-tab-en").addEventListener("click", () => {
        mcqGuideActiveTab = "english";
        renderMcqGuideList();
    });
    document.getElementById("mcq-guide-tab-hi").addEventListener("click", () => {
        mcqGuideActiveTab = "hindi";
        renderMcqGuideList();
    });
    document.getElementById("mcq-guide-overlay").addEventListener("click", e => {
        if (e.target.id === "mcq-guide-overlay") closeGuide();
    });
}

// PHASE 8b — makes the Full Set/Individual toggle's real effect
// visible: reactive label text + required attribute on Collection name.
function updateMcqCollectionRequirement(mode) {
    const label = document.getElementById("mcq-collection-label");
    const input = document.getElementById("mcq-collection");
    if (!label || !input) return;
    if (mode === "full") {
        label.innerHTML = `<span class="mcq-field-num mcq-num-red" id="mcq-field-num-2">2.</span> Collection name *`;
        input.required = true;
    } else {
        label.innerHTML = `<span class="mcq-field-num mcq-num-green" id="mcq-field-num-2">2.</span> Collection name (optional)`;
        input.required = false;
    }
}

function openAddMcqModal() {
    document.getElementById("add-mcq-modal")?.remove();
    refreshSitewideMcqTagSuggestions();

    const topic = currentMcqTopic || findFirstTopic(mcqStudyData.subjects);
    if (topic) currentMcqTopic = topic;

    const topicOptions = flattenMcqTopics(mcqStudyData.subjects).map(({ node, depth }) =>
        `<option value="${mcqEscapeHtml(node.id)}" ${node.id === topic?.id ? "selected" : ""}>${"&nbsp;".repeat(depth * 3)}${mcqEscapeHtml(node.title)}</option>`
    ).join("");

    const suggestedName = buildMcqSuggestedFileName(topic);

    const modal = document.createElement("div");
    modal.id = "add-mcq-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-add-modal">
                <button type="button" class="modal-close mcq-guide-icon" id="mcq-guide-open" title="Guide" aria-label="Open field guide">?</button>
                <button type="button" class="modal-close" id="mcq-add-close">×</button>
                <h2>➕ Add MCQs</h2>
                <p class="add-resource-scope">Current topic: <strong>${mcqEscapeHtml(topic?.title || "Not selected")}</strong></p>

                <label class="mcq-field-label"><span class="mcq-field-num mcq-num-yellow">1.</span> Import mode</label>
                <div class="resource-type-options" role="group" aria-label="Import mode">
                    <button type="button" id="mcq-mode-full" class="primary">Full Set / Paper</button>
                    <button type="button" id="mcq-mode-individual">Individual MCQ</button>
                </div>
                <p class="drive-note">Mode is a view-only switch for now. Both modes use the same import pipeline.</p>

                <label for="mcq-collection" id="mcq-collection-label"><span class="mcq-field-num mcq-num-red" id="mcq-field-num-2">2.</span> Collection name *</label>
                <input id="mcq-collection" type="text" placeholder="e.g. UGC NET 2025 Paper II" required>

                <label for="mcq-drive-link"><span class="mcq-field-num mcq-num-red">3.</span> Google Drive .md link *</label>
                <input id="mcq-drive-link" type="url" placeholder="https://drive.google.com/file/d/.../view">
                <p class="drive-note">The file must be shared as <strong>"Anyone with the link can view"</strong>.</p>

                <label for="mcq-description"><span class="mcq-field-num mcq-num-green">4.</span> Description</label>
                <textarea id="mcq-description" rows="2" placeholder="Optional description"></textarea>

                <label><span class="mcq-field-num mcq-num-green">5.</span> Tags <small>(optional — select from the Index)</small></label>
                <div id="mcq-tag-chips" class="mcq-tag-chip-wrap"></div>
                <div style="position:relative">
                    <input id="mcq-tag-input" type="text" placeholder="Search existing index terms...">
                    <div id="mcq-tag-suggestions" class="drive-note" hidden></div>
                </div>

                <label for="mcq-study-topic"><span class="mcq-field-num mcq-num-green">6.</span> Study Topic</label>
                <select id="mcq-study-topic">
                    <option value="">— Optional —</option>
                    ${topicOptions}
                </select>

                <label for="mcq-lang-count"><span class="mcq-field-num mcq-num-yellow">7.</span> How many languages?</label>
                <select id="mcq-lang-count">
                    ${Array.from({ length: 23 }, (_, i) => i + 1).map(n =>
                        `<option value="${n}" ${n === 1 ? "selected" : ""}>${n}</option>`).join("")}
                </select>
                <div id="mcq-lang-select-row" class="mcq-lang-select-row"></div>

                <label><span class="mcq-field-num mcq-num-red">8.</span> Question type(s) to include in the prompt</label>
                <div id="mcq-type-options" class="resource-type-options">
                    <label><input type="checkbox" value="simple" checked> Simple</label>
                    <label><input type="checkbox" value="assertion_reason"> Assertion–Reasoning</label>
                    <label><input type="checkbox" value="comprehension"> Comprehension</label>
                    <label><input type="checkbox" value="table"> Table/DI</label>
                    <label><input id="mcq-include-math" type="checkbox"> Include math</label>
                </div>

                <label for="mcq-question-count"><span class="mcq-field-num mcq-num-yellow">9.</span> How many questions?</label>
                <input id="mcq-question-count" type="number" min="1" value="10">

                <div class="content-action-row">
                    <button type="button" id="mcq-copy-prompt" class="content-action"><span class="mcq-field-num mcq-num-green">10.</span> 📋 Copy AI Prompt</button>
                </div>

                <details class="content-link-guide">
                    <summary>Tag format reference</summary>
                    <pre class="content-link-guide-body">${mcqEscapeHtml(`@collection: Collection Name
@question_no: 1
@type: simple | assertion_reason
@topic: node_id
@passage: p001
@question: Question text
@assertion: Assertion text
@reason: Reason text
@options:
A) Option A
B) Option B
C) Option C
D) Option D
@correct: A
@explanation: Explanation
@difficulty: easy | medium | hard
@language: en | hi | Hinglish | Mixed
@tags: tag1, tag2
@description: Description
@exam: UGC NET
@year: 2025
@session: June
@source: Source name
@source_question_no: 12
@end`)}</pre>
                </details>

                <label for="mcq-suggested-filename"><span class="mcq-field-num mcq-num-yellow">11.</span> Suggested file name</label>
                <div class="content-action-row">
                    <input id="mcq-suggested-filename" type="text" readonly value="${mcqEscapeHtml(suggestedName)}">
                    <button type="button" id="mcq-copy-name" class="content-action">📋 Copy Name</button>
                </div>

                <button class="resource-submit-btn" type="button" id="mcq-fetch-preview"><span class="mcq-field-num mcq-num-red">12.</span> Fetch &amp; Preview</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    document.getElementById("mcq-add-close").addEventListener("click", closeAddMcqModal);
    document.getElementById("mcq-guide-open").addEventListener("click", openMcqGuideModal);
    document.getElementById("mcq-copy-prompt").addEventListener("click", copyMcqAiPrompt);
    document.getElementById("mcq-copy-name").addEventListener("click", copyMcqSuggestedName);
    document.getElementById("mcq-fetch-preview").addEventListener("click", submitAddMcq);

    document.getElementById("mcq-study-topic").addEventListener("change", e => {
        const selected = findTopic(mcqStudyData.subjects, e.target.value);
        if (selected) {
            currentMcqTopic = selected;
            document.getElementById("mcq-suggested-filename").value = buildMcqSuggestedFileName(selected);
            const scope = modal.querySelector(".add-resource-scope strong");
            if (scope) scope.textContent = selected.title;
        }
    });

    // PHASE 8a — renders exactly 1 language dropdown by default; the
    // "How many languages?" select adds/removes dropdowns from there.
    renderMcqLanguageSelects(1);
    document.getElementById("mcq-lang-count").addEventListener("change", e => {
        renderMcqLanguageSelects(e.target.value);
    });

    // PHASE 8a — selection-only: Enter/comma no longer creates a
    // free-typed tag. It only confirms the top matching Index_Terms
    // suggestion, if one is showing; typing with no match does nothing.
    const tagInput = document.getElementById("mcq-tag-input");
    tagInput.addEventListener("input", () => renderMcqTagSuggestions(tagInput.value));
    tagInput.addEventListener("focus", () => renderMcqTagSuggestions(tagInput.value));
    tagInput.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            const topMatch = getMcqIndexTermSuggestions(tagInput.value)
                .find(tag => !getMcqTagChips().some(x => x.toLowerCase() === tag.toLowerCase()));
            if (topMatch) addMcqTagChip(topMatch);
            tagInput.value = "";
            renderMcqTagSuggestions("");
        }
    });

    // PHASE 8b — fix: the tag suggestions dropdown previously never
    // closed on outside click. Bind once per modal-open, unbind on
    // close so repeated opens don't stack duplicate listeners.
    bindMcqTagOutsideClick();

    const modeFull = document.getElementById("mcq-mode-full");
    const modeIndividual = document.getElementById("mcq-mode-individual");
    updateMcqCollectionRequirement("full"); // "Full Set / Paper" is the default active mode
    modeFull.addEventListener("click", () => {
        modeFull.classList.add("primary");
        modeIndividual.classList.remove("primary");
        updateMcqCollectionRequirement("full");
    });
    modeIndividual.addEventListener("click", () => {
        modeIndividual.classList.add("primary");
        modeFull.classList.remove("primary");
        updateMcqCollectionRequirement("individual");
    });
}

function copyMcqSuggestedName() {
    const box = document.getElementById("mcq-suggested-filename");
    if (!box) return;
    const done = () => alert("File name copied!");
    const manual = () => {
        box.select();
        alert("Could not copy automatically — the name is now selected. Press Ctrl+C / Cmd+C to copy it.");
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(box.value).then(done).catch(manual);
    } else {
        manual();
    }
}

// PHASE 8b — outside-click handler for the tag suggestions dropdown.
// Kept as a module-level reference so it can be removed cleanly
// (bindMcqTagOutsideClick re-binds on every modal open; closeAddMcqModal
// unbinds it) instead of piling up a new document listener each time.
let mcqTagOutsideClickHandler_ = null;

function bindMcqTagOutsideClick() {
    if (mcqTagOutsideClickHandler_) {
        document.removeEventListener("click", mcqTagOutsideClickHandler_);
    }
    mcqTagOutsideClickHandler_ = function (e) {
        const box = document.getElementById("mcq-tag-suggestions");
        const input = document.getElementById("mcq-tag-input");
        if (!box || !input) return;
        if (box.hidden) return;
        if (!box.contains(e.target) && !input.contains(e.target)) {
            box.hidden = true;
        }
    };
    document.addEventListener("click", mcqTagOutsideClickHandler_);
}

function closeAddMcqModal() {
    document.getElementById("add-mcq-modal")?.remove();
    if (mcqTagOutsideClickHandler_) {
        document.removeEventListener("click", mcqTagOutsideClickHandler_);
        mcqTagOutsideClickHandler_ = null;
    }
}

async function fetchMcqMarkdown(ref) {
    const url = `${GOOGLE_SHEET_API}?action=get_markdown&ref=${encodeURIComponent(ref)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch the Drive file (${response.status}).`);
    const result = await response.json();
    if (!result?.ok) throw new Error(result?.error || "Could not read the Drive Markdown file.");
    return String(result.content || "");
}

function isMcqFatal(row) {
    const warnings = row.warnings || [];
    const text = warnings.join(" | ").toLowerCase();
    return !row.question || !row.option_a || !row.option_b || !row.option_c || !row.option_d ||
        !/^[0-3]$/.test(String(row.correct_option)) ||
        text.includes("missing @question") ||
        text.includes("missing @options") ||
        text.includes("missing @correct");
}

function resolveMcqTopicTitle(nodeId) {
    const node = findTopic(mcqStudyData.subjects, nodeId);
    return node ? node.title : "";
}

function applyMcqPopupDefaults(parsed) {
    const collection = document.getElementById("mcq-collection")?.value.trim() || "";
    const description = document.getElementById("mcq-description")?.value.trim() || "";
    // PHASE 8a — only fall back to a default @language when exactly
    // one non-English language was selected; with N>=2 the AI prompt
    // already instructs an explicit @language per block, so guessing
    // a single default here would be wrong.
    const selectedLanguages = getMcqSelectedLanguages();
    const language = (selectedLanguages.length === 1 && selectedLanguages[0].toLowerCase() !== "english")
        ? selectedLanguages[0] : "";
    const topic = document.getElementById("mcq-study-topic")?.value.trim() || "";
    const tags = getMcqTagChips().join(", ");

    parsed.mcqs.forEach(row => {
        if (!row.collection_id_ref && collection) row.collection_id_ref = collection;
        if (!row.tags && tags) row.tags = tags;
        if (!row.language && language) row.language = language;
        if (!row.node_id && topic) row.node_id = topic;
        if (!row.description && description) row.description = description;
    });

    // Preserve collection metadata supplied by the popup as a fallback.
    if (collection) {
        const existing = parsed.collections.find(c => c.title === collection);
        if (existing) {
            if (!existing.description && description) existing.description = description;
        } else {
            parsed.collections.push({
                title: collection,
                description: description,
                exam: "",
                year: "",
                session: "",
                source: ""
            });
        }
    }
    return parsed;
}

function renderMcqPreviewModal(parsed) {
    mcqPreviewRows = parsed.mcqs.map((row, index) => ({
        row,
        index,
        fatal: isMcqFatal(row),
        checked: !isMcqFatal(row)
    }));

    document.getElementById("mcq-preview-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "mcq-preview-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-preview-modal">
                <button type="button" class="modal-close" id="mcq-preview-close">×</button>
                <h2>MCQ Import Preview</h2>
                <p class="add-resource-scope" id="mcq-preview-count"></p>
                <div class="mcq-preview-table-wrap">
                    <table class="mcq-preview-table">
                        <thead><tr>
                            <th>✓</th><th>Topic</th><th>Collection</th><th>Type</th><th>Question</th><th>Status</th>
                        </tr></thead>
                        <tbody id="mcq-preview-body"></tbody>
                    </table>
                </div>
                <div class="content-action-row">
                    <button class="resource-submit-btn" type="button" id="mcq-confirm-save">Confirm & Save All</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    document.getElementById("mcq-preview-close").addEventListener("click", () => modal.remove());

    const body = document.getElementById("mcq-preview-body");
    body.innerHTML = mcqPreviewRows.map(item => {
        const row = item.row;
        const topicTitle = resolveMcqTopicTitle(row.node_id);
        const topicDisplay = topicTitle
            ? mcqEscapeHtml(topicTitle)
            : `<span class="mcq-preview-unknown">⚠ unknown topic</span>`;
        const warnings = row.warnings || [];
        const status = item.fatal
            ? `<span class="mcq-preview-fatal" title="${mcqEscapeHtml(warnings.join("; ") || "Required field missing")}">❌ ${mcqEscapeHtml(warnings.join("; ") || "Required field missing")}</span>`
            : warnings.length
                ? `<span class="mcq-preview-warning" title="${mcqEscapeHtml(warnings.join("; "))}">⚠ ${mcqEscapeHtml(warnings.join("; "))}</span>`
                : `<span>✅ Ready</span>`;
        const question = String(row.question || "").replace(/\s+/g, " ").trim();
        return `<tr>
            <td><input type="checkbox" class="mcq-preview-check" data-index="${item.index}" ${item.checked ? "checked" : ""} ${item.fatal ? "" : ""}></td>
            <td>${topicDisplay}</td>
            <td>${mcqEscapeHtml(row.collection_id_ref || "")}</td>
            <td>${mcqEscapeHtml(row.question_type || "simple")}</td>
            <td title="${mcqEscapeHtml(row.question || "")}">${mcqEscapeHtml(question.length > 100 ? question.slice(0, 100) + "…" : question)}</td>
            <td>${status}</td>
        </tr>`;
    }).join("");

    function updatePreviewCount() {
        const checks = Array.from(document.querySelectorAll(".mcq-preview-check"));
        const checked = checks.filter(c => c.checked).length;
        const flagged = mcqPreviewRows.filter(x => x.fatal || (x.row.warnings || []).length).length;
        const count = document.getElementById("mcq-preview-count");
        if (count) count.textContent = `${checked} of ${mcqPreviewRows.length} questions ready to import (${flagged} flagged)`;
        const save = document.getElementById("mcq-confirm-save");
        if (save) save.disabled = checked === 0;
    }

    body.querySelectorAll(".mcq-preview-check").forEach(check => {
        check.addEventListener("change", updatePreviewCount);
    });

    updatePreviewCount();
    document.getElementById("mcq-confirm-save").addEventListener("click", confirmSaveMcqs);
}

async function submitAddMcq() {
    // PHASE 8b — Collection name's required-ness is reactive to the
    // Full Set/Individual toggle (updateMcqCollectionRequirement());
    // this button isn't a real <form> submit, so enforce it manually.
    const collectionInput = document.getElementById("mcq-collection");
    if (collectionInput && collectionInput.required && !collectionInput.value.trim()) {
        alert("Please enter a Collection name (required in Full Set / Paper mode).");
        collectionInput.focus();
        return;
    }

    const ref = document.getElementById("mcq-drive-link")?.value.trim();
    if (!ref) {
        alert("Please paste a Google Drive link to the .md file.");
        return;
    }

    const btn = document.getElementById("mcq-fetch-preview");
    if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }

    try {
        if (typeof window.parseMcqMarkdown !== "function") {
            throw new Error("MCQ parser is not loaded. Please refresh the page.");
        }
        const text = await fetchMcqMarkdown(ref);
        const parsed = window.parseMcqMarkdown(text);
        window.__mcqLastParsedPassages = parsed.passages || [];
        applyMcqPopupDefaults(parsed);

        if (!parsed.mcqs.length) {
            throw new Error("No question blocks were found in this Markdown file.");
        }

        closeAddMcqModal();
        renderMcqPreviewModal(parsed);
    } catch (error) {
        console.error("MCQ import preview failed:", error);
        alert(error.message || "Could not fetch or parse the Markdown file.");
        if (btn) { btn.disabled = false; btn.textContent = "Fetch & Preview"; }
    }
}

async function confirmSaveMcqs() {
    const checks = Array.from(document.querySelectorAll(".mcq-preview-check:checked"));
    const selected = checks.map(c => mcqPreviewRows[Number(c.dataset.index)].row);
    if (!selected.length) return;

    const btn = document.getElementById("mcq-confirm-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    const selectedIds = new Set(selected.map(row => row.mcq_id));
    const collections = [];
    const collectionSeen = new Set();
    selected.forEach(row => {
        const title = String(row.collection_id_ref || "").trim();
        if (!title || collectionSeen.has(title)) return;
        collectionSeen.add(title);
        const source = (mcqPreviewRows.find(x => x.row === row)?.row) || row;
        collections.push({
            title,
            description: row.description || "",
            exam: row.exam || "",
            year: row.year || "",
            session: row.session || "",
            source: row.source || ""
        });
    });

    const passages = [];
    const passageIds = new Set(selected.map(r => r.passage_id).filter(Boolean));
    // Passage payload is taken from the source parse when available.
    // Rebuild from preview selection is intentionally conservative.
    const parsedPassages = window.__mcqLastParsedPassages || [];
    parsedPassages.forEach(p => {
        if (passageIds.has(p.passage_id)) passages.push(p);
    });

    const payload = {
        action: "save_mcqs_bulk",
        collections,
        passages,
        mcqs: selected
    };

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify(payload)
        });

        const added = selected.filter(r => !r.mcq_id || !mcqApiData.mcqs?.some(x => String(x.mcq_id) === String(r.mcq_id))).length;
        const updated = selected.length - added;

        document.getElementById("mcq-preview-modal")?.remove();
        alert(`${added} questions added, ${updated} updated.`);

        // Refresh practice data when the current topic is affected.
        if (selected.some(r => r.node_id === currentMcqTopic?.id)) {
            try {
                const freshTree = await loadStudyTree();
                mcqStudyData = freshTree;
                const freshTopic = findTopic(freshTree.subjects, currentMcqTopic.id);
                currentMcqTopic = freshTopic || currentMcqTopic;
                currentMcqs = freshTopic
                    ? await loadMcqsForTopic(freshTopic.id)
                    : currentMcqs;
                currentMcqIndex = 0;
                resetAttemptState();
                renderMcqView();
            } catch (refreshError) {
                console.warn("MCQ view refresh failed:", refreshError);
            }
        }
    } catch (error) {
        console.error("MCQ bulk save failed:", error);
        alert("Could not save the MCQs. Check the Apps Script endpoint and try again.");
        if (btn) { btn.disabled = false; btn.textContent = "Confirm & Save All"; }
    }
}



/* =========================================================
   PHASE 6 — single-MCQ metadata editing
   Only classification/visibility metadata is editable here.
   ========================================================= */
function getMcqMetaTopicOptions(selectedId) {
    return flattenMcqTopics(mcqStudyData.subjects).map(({ node, depth }) => `
        <option value="${mcqEscapeHtml(node.id)}" ${node.id === selectedId ? "selected" : ""}>${"&nbsp;".repeat(depth * 3)}${mcqEscapeHtml(node.title)}</option>
    `).join("");
}

function getEditMcqTagChips() {
    return Array.from(document.querySelectorAll("#mcq-meta-tag-chips .mcq-tag-chip"))
        .map(chip => chip.dataset.tag || "")
        .filter(Boolean);
}

function addEditMcqTagChip(value) {
    const clean = String(value || "").trim().replace(/^,+|,+$/g, "");
    if (!clean) return;
    if (getEditMcqTagChips().some(tag => tag.toLowerCase() === clean.toLowerCase())) return;
    const wrap = document.getElementById("mcq-meta-tag-chips");
    if (!wrap) return;
    const chip = document.createElement("span");
    chip.className = "mcq-tag-chip";
    chip.dataset.tag = clean;
    chip.innerHTML = `${mcqEscapeHtml(clean)} <button type="button" aria-label="Remove tag">×</button>`;
    chip.querySelector("button").addEventListener("click", () => chip.remove());
    wrap.appendChild(chip);
}

function renderEditMcqTagSuggestions(value) {
    const box = document.getElementById("mcq-meta-tag-suggestions");
    if (!box) return;
    const q = String(value || "").trim().toLowerCase();
    const matches = mcqTagSuggestions
        .filter(tag => !getEditMcqTagChips().some(x => x.toLowerCase() === tag.toLowerCase()))
        .filter(tag => !q || tag.toLowerCase().includes(q))
        .slice(0, 8);
    box.innerHTML = matches.map(tag =>
        `<button type="button" data-tag="${mcqEscapeHtml(tag)}">${mcqEscapeHtml(tag)}</button>`
    ).join("");
    box.hidden = matches.length === 0;
    box.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
        addEditMcqTagChip(btn.dataset.tag);
        const input = document.getElementById("mcq-meta-tag-input");
        if (input) { input.value = ""; input.focus(); }
        renderEditMcqTagSuggestions("");
    }));
}

function openMcqMetaModal(mcq) {
    document.getElementById("mcq-meta-modal")?.remove();

    const topicOptions = getMcqMetaTopicOptions(mcq.node_id || currentMcqTopic?.id || "");
    const tags = String(mcq.tags || "").split(",").map(t => t.trim()).filter(Boolean);

    const modal = document.createElement("div");
    modal.id = "mcq-meta-modal";
    modal.innerHTML = `
        <div class="add-resource-overlay">
            <div class="add-resource-modal mcq-meta-modal">
                <button type="button" class="modal-close" id="mcq-meta-close">×</button>
                <h2>✏️ Edit MCQ Metadata</h2>
                <p class="add-resource-scope"><strong>${mcqEscapeHtml(mcq.question)}</strong></p>

                <label for="mcq-meta-topic">Topic</label>
                <select id="mcq-meta-topic">${topicOptions}</select>

                <label for="mcq-meta-difficulty">Difficulty</label>
                <select id="mcq-meta-difficulty">
                    <option value="" ${!mcq.difficulty ? "selected" : ""}>— Not set —</option>
                    <option value="easy" ${String(mcq.difficulty).toLowerCase() === "easy" ? "selected" : ""}>Easy</option>
                    <option value="medium" ${String(mcq.difficulty).toLowerCase() === "medium" ? "selected" : ""}>Medium</option>
                    <option value="hard" ${String(mcq.difficulty).toLowerCase() === "hard" ? "selected" : ""}>Hard</option>
                </select>

                <label for="mcq-meta-language">Language</label>
                <input id="mcq-meta-language" type="text" value="${mcqEscapeHtml(mcq.language || "")}" placeholder="English / Hindi / Hinglish / Mixed / Other">

                <label>Tags</label>
                <div id="mcq-meta-tag-chips" class="mcq-tag-chip-wrap"></div>
                <div style="position:relative">
                    <input id="mcq-meta-tag-input" type="text" placeholder="Type a tag, then Enter">
                    <div id="mcq-meta-tag-suggestions" class="drive-note" hidden></div>
                </div>

                <label for="mcq-meta-description">Description</label>
                <textarea id="mcq-meta-description" rows="3" placeholder="Optional description">${mcqEscapeHtml(mcq.description || "")}</textarea>

                <label for="mcq-meta-status">Status</label>
                <select id="mcq-meta-status">
                    <option value="published" ${String(mcq.status || "").toLowerCase() !== "archived" ? "selected" : ""}>Published</option>
                    <option value="archived" ${String(mcq.status || "").toLowerCase() === "archived" ? "selected" : ""}>Archived</option>
                </select>

                <div class="modal-actions">
                    <button type="button" id="mcq-meta-cancel">Cancel</button>
                    <button type="button" id="mcq-meta-save" class="primary">Save Changes</button>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    tags.forEach(addEditMcqTagChip);

    const tagInput = document.getElementById("mcq-meta-tag-input");
    tagInput?.addEventListener("input", () => renderEditMcqTagSuggestions(tagInput.value));
    tagInput?.addEventListener("focus", () => renderEditMcqTagSuggestions(tagInput.value));
    tagInput?.addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            addEditMcqTagChip(tagInput.value);
            tagInput.value = "";
            renderEditMcqTagSuggestions("");
        }
    });

    document.getElementById("mcq-meta-close")?.addEventListener("click", () => modal.remove());
    document.getElementById("mcq-meta-cancel")?.addEventListener("click", () => modal.remove());
    modal.querySelector(".add-resource-overlay")?.addEventListener("click", e => {
        if (e.target === e.currentTarget) modal.remove();
    });
    document.getElementById("mcq-meta-save")?.addEventListener("click", () => saveMcqMeta(mcq));
}

async function saveMcqMeta(mcq) {
    const topicId = document.getElementById("mcq-meta-topic")?.value || "";
    const difficulty = document.getElementById("mcq-meta-difficulty")?.value || "";
    const language = document.getElementById("mcq-meta-language")?.value.trim() || "";
    const tags = getEditMcqTagChips().join(", ");
    const description = document.getElementById("mcq-meta-description")?.value.trim() || "";
    const status = document.getElementById("mcq-meta-status")?.value || "published";

    const fields = {};
    const oldDifficulty = String(mcq.difficulty || "");
    const oldLanguage = String(mcq.language || "");
    const oldTags = String(mcq.tags || "").split(",").map(t => t.trim()).filter(Boolean).join(", ");
    const oldDescription = String(mcq.description || "");
    const oldStatus = String(mcq.status || "").trim() || "published";

    if (topicId !== String(mcq.node_id || "")) fields.node_id = topicId;
    if (difficulty !== oldDifficulty) fields.difficulty = difficulty;
    if (language !== oldLanguage) fields.language = language;
    if (tags !== oldTags) fields.tags = tags;
    if (description !== oldDescription) fields.description = description;
    if (status !== oldStatus) fields.status = status;

    if (!Object.keys(fields).length) {
        document.getElementById("mcq-meta-modal")?.remove();
        return;
    }

    const btn = document.getElementById("mcq-meta-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    try {
        await fetch(GOOGLE_SHEET_API, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                action: "update_mcq_meta",
                mcq_id: mcq.id,
                fields
            })
        });

        document.getElementById("mcq-meta-modal")?.remove();
        await refreshCurrentMcqTopic();
        alert("MCQ metadata updated.");
    } catch (error) {
        console.error("MCQ metadata update failed:", error);
        alert("Could not update the MCQ metadata. Check the Apps Script endpoint and try again.");
        if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; }
    }
}

async function refreshCurrentMcqTopic() {
    if (!currentMcqTopic) return;
    const freshTree = await loadStudyTree();
    mcqStudyData = freshTree;
    const freshTopic = findTopic(freshTree.subjects, currentMcqTopic.id);
    currentMcqTopic = freshTopic || currentMcqTopic;
    allLoadedMcqs = await loadMcqsForTopic(currentMcqTopic.id);
    currentCollectionView = null;
    selectedMcqTags = new Set();
    selectedMcqLanguage = "";
    populateMcqPracticeFilters();
    currentMcqs = allLoadedMcqs.slice();
    currentMcqIndex = Math.min(currentMcqIndex, Math.max(0, currentMcqs.length - 1));
    resetAttemptState();
    renderMcqCollectionNotes();
    renderMcqView();
}

document.getElementById("mcq-add-open")?.addEventListener("click", openAddMcqModal);
