const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

let questions = [];
let studentAnswers = [];
let mediaFiles = [];
let studentPhones = {};

// =====================================================
// BULK SCHEDULE (server-side so all devices sync)
// =====================================================
let bulkSchedule = null;

app.get("/schedule", (req, res) => {
    res.json(bulkSchedule || { empty: true });
});

app.post("/schedule", (req, res) => {
    const { schedule } = req.body;
    if (!schedule) return res.status(400).json({ error: "Schedule required" });
    bulkSchedule = schedule;
    res.json({ success: true, schedule: bulkSchedule });
});

app.delete("/schedule", (req, res) => {
    bulkSchedule = null;
    res.json({ success: true });
});

// Patch a single question's posted status (called after auto-post)
app.post("/schedule/mark-posted", (req, res) => {
    const { index, postedAt } = req.body;
    if (!bulkSchedule || !bulkSchedule.questions || index === undefined)
        return res.status(400).json({ error: "Invalid request" });
    if (bulkSchedule.questions[index]) {
        bulkSchedule.questions[index].posted = true;
        bulkSchedule.questions[index].postedAt = postedAt || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        // Track last auto-post
        bulkSchedule.lastAutoPost = {
            question: bulkSchedule.questions[index].question.substring(0, 50) + "...",
            time: bulkSchedule.questions[index].postedAt,
            day: index + 1
        };
    }
    res.json({ success: true, schedule: bulkSchedule });
});

// =====================================================
// SCORES (server-side so all devices share leaderboard)
// =====================================================
let studentScores = {};   // { pin: { name, scores: [{date, points}] } }
let studentStreaks = {};  // { pin: { count, lastDate } }

app.get("/scores", (req, res) => res.json({ scores: studentScores, streaks: studentStreaks }));

app.post("/scores", (req, res) => {
    const { pin, name, points, date } = req.body;
    if (!pin || !name || !points || !date) return res.status(400).json({ error: "All fields required" });
    if (!studentScores[pin]) studentScores[pin] = { name, scores: [] };
    studentScores[pin].name = name;
    // Only award once per day
    if (!studentScores[pin].scores.find(s => s.date === date)) {
        studentScores[pin].scores.push({ date, points });
    }
    // Update streak
    if (!studentStreaks[pin]) {
        studentStreaks[pin] = { count: 1, lastDate: date };
    } else {
        const last = studentStreaks[pin].lastDate;
        const diff = Math.round(Math.abs(new Date(date) - new Date(last)) / (1000 * 60 * 60 * 24));
        if (diff === 0) { /* same day, no change */ }
        else if (diff === 1) { studentStreaks[pin].count += 1; studentStreaks[pin].lastDate = date; }
        else { studentStreaks[pin].count = 1; studentStreaks[pin].lastDate = date; }
    }
    res.json({ success: true });
});

// =====================================================
// QUESTIONS
// =====================================================
app.get("/questions", (req, res) => res.json(questions));

app.post("/questions", (req, res) => {
    const { question, answer } = req.body;
    if (!question) return res.status(400).json({ error: "Question is required" });
    const newQuestion = {
        id: Date.now(), question,
        answer: (answer && answer.trim()) ? answer.trim() : null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    questions.push(newQuestion);
    res.json({ success: true, message: "Question posted successfully", question: newQuestion });
});

app.get("/questions/:id", (req, res) => {
    const q = questions.find(q => q.id === parseInt(req.params.id));
    q ? res.json(q) : res.status(404).json({ error: "Question not found" });
});

const setAnswer = (req, res) => {
    const { answer } = req.body;
    const q = questions.find(q => q.id === parseInt(req.params.id));
    if (!q) return res.status(404).json({ error: "Question not found" });
    if (!answer || !answer.trim()) return res.status(400).json({ error: "Answer is required" });
    q.answer = answer.trim();
    res.json({ success: true, question: q });
};
app.put("/questions/:id/answer", setAnswer);
app.post("/questions/:id/answer", setAnswer);

app.delete("/questions/reset", (req, res) => { questions = []; res.json({ success: true }); });

// =====================================================
// ANSWERS
// =====================================================
app.get("/answers", (req, res) => res.json(studentAnswers));

app.get("/answers/question/:questionId", (req, res) => {
    res.json(studentAnswers.filter(a => a.questionId === parseInt(req.params.questionId)));
});

app.post("/answers", (req, res) => {
    const { questionId, studentPin, studentName, answer, type } = req.body;
    if (!questionId || !studentPin || !studentName || !answer)
        return res.status(400).json({ error: "All fields are required" });
    const existing = studentAnswers.find(a =>
        a.questionId === questionId && a.studentPin === studentPin &&
        (a.type || "question") === (type || "question")
    );
    if (existing) return res.status(400).json({ error: "You have already answered this" });
    const newAnswer = {
        id: Date.now(), questionId, studentPin, studentName, answer,
        type: type || "question",
        submittedAt: new Date().toISOString(),
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    studentAnswers.push(newAnswer);
    res.json({ success: true, message: "Answer submitted successfully", answer: newAnswer });
});

// =====================================================
// MEDIA
// =====================================================
app.get("/media", (req, res) => res.json(mediaFiles));

app.post("/media", (req, res) => {
    const { type, data, fileName, opinion, expectedAnswer } = req.body;
    if (!type || !data || !fileName || !opinion)
        return res.status(400).json({ error: "All fields are required" });
    const newMedia = {
        id: Date.now(), type, data, fileName, opinion,
        expectedAnswer: expectedAnswer || null, explanation: null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    mediaFiles.push(newMedia);
    res.json({ success: true, media: newMedia });
});

app.get("/media/latest", (req, res) => {
    mediaFiles.length > 0 ? res.json(mediaFiles[mediaFiles.length - 1]) : res.status(404).json({ error: "No media" });
});

app.post("/media/:id/explanation", (req, res) => {
    const m = mediaFiles.find(m => m.id === parseInt(req.params.id));
    if (!m) return res.status(404).json({ error: "Not found" });
    m.explanation = req.body.explanation;
    res.json({ success: true, media: m });
});

app.delete("/media/:id", (req, res) => {
    const idx = mediaFiles.findIndex(m => m.id === parseInt(req.params.id));
    idx !== -1 ? (mediaFiles.splice(idx, 1), res.json({ success: true })) : res.status(404).json({ error: "Not found" });
});

// =====================================================
// PHONES
// =====================================================
app.get("/phones", (req, res) => res.json(studentPhones));

app.post("/phones", (req, res) => {
    const { pin, name, phone } = req.body;
    if (!pin || !name || !phone) return res.status(400).json({ error: "All fields required" });
    studentPhones[pin] = { name, phone, lastLogin: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) };
    res.json({ success: true });
});

// =====================================================
// STATS / HEALTH / API INFO
// =====================================================
app.get("/stats", (req, res) => res.json({
    totalQuestions: questions.length,
    totalAnswers: studentAnswers.length,
    totalMedia: mediaFiles.length,
    totalStudents: Object.keys(studentPhones).length,
    uniqueStudents: [...new Set(studentAnswers.map(a => a.studentPin))].length,
    latestQuestionDate: questions.length > 0 ? questions[questions.length - 1].date : null,
    questionAnswers: studentAnswers.filter(a => (!a.type || a.type === "question")).length,
    mediaAnswers: studentAnswers.filter(a => a.type === "media").length
}));

app.get("/health", (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString(), uptime: process.uptime() }));

app.get("/api", (req, res) => res.json({
    message: "TEJAPRATAP QUIZ API v4.0", status: "running",
    endpoints: {
        "GET  /questions": "All questions",
        "POST /questions": "Post { question, answer }",
        "PUT  /questions/:id/answer": "Set answer { answer }",
        "POST /answers": "Submit answer",
        "GET  /schedule": "Get bulk schedule (synced across devices)",
        "POST /schedule": "Save bulk schedule { schedule }",
        "POST /schedule/mark-posted": "Mark question posted { index, postedAt }",
        "DELETE /schedule": "Reset schedule",
        "GET  /scores": "Get all scores + streaks",
        "POST /scores": "Add score { pin, name, points, date }",
        "POST /media": "Upload media",
        "GET  /phones": "Student phones",
        "GET  /stats": "Stats"
    }
}));

app.post("/admin/reset-all", (req, res) => {
    if (req.body.confirmPassword !== "RESET_ALL_DATA_TEJAPRATAP") return res.status(403).json({ error: "Wrong password" });
    questions = []; studentAnswers = []; mediaFiles = []; studentPhones = {};
    bulkSchedule = null; studentScores = {}; studentStreaks = {};
    res.json({ success: true, message: "All data reset" });
});

app.use(express.static(__dirname));
app.get("/", (req, res) => { const p = path.join(__dirname, "index.html"); fs.existsSync(p) ? res.sendFile(p) : res.status(500).send("index.html not found"); });
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log("TEJAPRATAP QUIZ SERVER v4.0 on port " + PORT);
    console.log("App: http://localhost:" + PORT);
    console.log("API: http://localhost:" + PORT + "/api");
});
process.on("SIGTERM", () => server.close(() => console.log("Closed")));
module.exports = app;
