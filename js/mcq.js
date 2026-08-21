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


async function loadStudyData() {

    const response = await fetch(GOOGLE_SHEET_API);

    if (!response.ok) {
        throw new Error(
            `Google Sheet API failed (${response.status})`
        );
    }

    const apiData = await response.json();

    console.log("MCQ: Google Sheets data loaded:", apiData);

    return convertApiDataToMcqData(apiData);
}


function convertApiDataToMcqData(apiData) {

    const nodes = apiData.nodes || [];
    const mcqRows = apiData.mcqs || [];

    const nodeMap = {};

    // Create nodes
    nodes.forEach(row => {

        nodeMap[row.node_id] = {
            id: row.node_id,
            title: row.title,
            type: row.node_type,
            parentId: row.parent_id || null,
            children: [],
            mcqs: []
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


    // Attach MCQs using stable node_id
    mcqRows.forEach(row => {

        const node = nodeMap[row.node_id];

        if (!node) return;

        const correctOption = String(row.correct_option || "")
            .trim()
            .toUpperCase();

        const correctIndex = {
            A: 0,
            B: 1,
            C: 2,
            D: 3
        }[correctOption];

        node.mcqs.push({
            id: row.mcq_id,
            question: row.question || "",
            options: [
                row.option_a || "",
                row.option_b || "",
                row.option_c || "",
                row.option_d || ""
            ],
            answer: correctIndex ?? 0,
            explanation: row.explanation || ""
        });
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
            <div class="mcq-question-number">
                Question ${currentMcqIndex + 1} of ${currentMcqs.length}
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
        const data = await loadStudyData();

        const params = new URLSearchParams(window.location.search);
        const topicId = params.get("topic");

        const topic = topicId
            ? findTopic(data.subjects, topicId)
            : findFirstTopic(data.subjects);

        currentMcqs = topic?.mcqs || [];
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
        if (lang.value === "hi") {
            // Translation layer intentionally deferred; keep UI English for now.
            alert("Hindi question translation will be added later.");
            lang.value = "en";
        }
    });

    applySize();
})();
