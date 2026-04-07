const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// =====================================================
// DATA FILE PERSISTENCE (survives restarts)
// =====================================================
const DATA_FILE = path.join(__dirname, "data.json");

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, "utf8");
            return JSON.parse(raw);
        }
    } catch (e) { console.error("Load data error:", e.message); }
    return {};
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
            questions, studentAnswers, mediaFiles, studentPhones,
            bulkSchedule, studentScores, studentStreaks,
            wordItems, affairsItems,
            mediaSchedule, wordSchedule, affairsSchedule
        }, null, 2));
    } catch (e) { console.error("Save data error:", e.message); }
}

// Auto-save every 30 seconds
setInterval(saveData, 30000);

const saved = loadData();
let questions      = saved.questions      || [];
let studentAnswers = saved.studentAnswers || [];
let mediaFiles     = saved.mediaFiles     || [];
let studentPhones  = saved.studentPhones  || {};
let bulkSchedule   = saved.bulkSchedule   || null;
let studentScores  = saved.studentScores  || {};
let studentStreaks  = saved.studentStreaks || {};
let wordItems      = saved.wordItems      || [];  // Word of the Day
let affairsItems   = saved.affairsItems   || [];  // Current Affairs
let mediaSchedule  = saved.mediaSchedule  || null;
let wordSchedule   = saved.wordSchedule   || null;
let affairsSchedule = saved.affairsSchedule || null;

console.log(`✅ Data loaded: ${questions.length} questions, ${studentAnswers.length} answers, ${Object.keys(studentPhones).length} students`);

// =====================================================
// BULK SCHEDULE
// =====================================================
app.get("/schedule", (req, res) => {
    res.json(bulkSchedule || { empty: true });
});

app.post("/schedule", (req, res) => {
    const { schedule } = req.body;
    if (!schedule) return res.status(400).json({ error: "Schedule required" });
    bulkSchedule = schedule;
    saveData();
    res.json({ success: true, schedule: bulkSchedule });
});

app.delete("/schedule", (req, res) => {
    bulkSchedule = null;
    saveData();
    res.json({ success: true });
});

app.post("/schedule/mark-posted", (req, res) => {
    const { index, postedAt } = req.body;
    if (!bulkSchedule || !bulkSchedule.questions || index === undefined)
        return res.status(400).json({ error: "Invalid request" });
    if (bulkSchedule.questions[index]) {
        bulkSchedule.questions[index].posted = true;
        bulkSchedule.questions[index].postedAt = postedAt || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        bulkSchedule.lastAutoPost = {
            question: bulkSchedule.questions[index].question.substring(0, 50) + "...",
            time: bulkSchedule.questions[index].postedAt,
            day: index + 1
        };
    }
    saveData();
    res.json({ success: true, schedule: bulkSchedule });
});

// =====================================================
// SCORES
// =====================================================
app.get("/scores", (req, res) => res.json({ scores: studentScores, streaks: studentStreaks }));

app.post("/scores", (req, res) => {
    const { pin, name, points, date } = req.body;
    if (!pin || !name || !points || !date) return res.status(400).json({ error: "All fields required" });
    if (!studentScores[pin]) studentScores[pin] = { name, scores: [] };
    studentScores[pin].name = name;
    const existingScore = studentScores[pin].scores.find(s => s.date === date);
    if (existingScore) {
        existingScore.points += points;
    } else {
        studentScores[pin].scores.push({ date, points });
    }
    if (!studentStreaks[pin]) {
        studentStreaks[pin] = { count: 1, lastDate: date };
    } else {
        const last = studentStreaks[pin].lastDate;
        const diff = Math.round(Math.abs(new Date(date) - new Date(last)) / (1000 * 60 * 60 * 24));
        if (diff === 0) { }
        else if (diff === 1) { studentStreaks[pin].count += 1; studentStreaks[pin].lastDate = date; }
        else { studentStreaks[pin].count = 1; studentStreaks[pin].lastDate = date; }
    }
    saveData();
    res.json({ success: true });
});

// =====================================================
// QUESTIONS
// =====================================================
app.get("/questions", (req, res) => res.json(questions));

app.post("/questions", (req, res) => {
    const { question, answer, answerOpinion, questionFile, questionFileType } = req.body;
    if (!question) return res.status(400).json({ error: "Question is required" });

    // Save attached image/audio to disk if provided
    let fileUrl = null;
    if (questionFile && questionFileType) {
        try {
            const base64Data = questionFile.includes(',') ? questionFile.split(',')[1] : questionFile;
            const ext = questionFileType === 'audio' ? 'mp3' : 'jpg';
            const uniqueName = `gk_${Date.now()}.${ext}`;
            const filePath = path.join(UPLOADS_DIR, uniqueName);
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            fileUrl = `/uploads/${uniqueName}`;
        } catch(e) {
            console.error('GK file save error:', e.message);
        }
    }

    const newQuestion = {
        id: Date.now(), question,
        answer: (answer && answer.trim()) ? answer.trim() : null,
        answerOpinion: answerOpinion || null,
        questionFile: fileUrl || (questionFile && questionFile.length < 500000 ? questionFile : null),
        questionFileType: questionFileType || null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    questions.push(newQuestion);
    saveData();
    res.json({ success: true, message: "Question posted successfully", question: newQuestion });
});

// Literal routes BEFORE parameterized /:id routes
app.delete("/questions/reset", (req, res) => { questions = []; saveData(); res.json({ success: true }); });

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
    saveData();
    res.json({ success: true, question: q });
};
app.put("/questions/:id/answer", setAnswer);
app.post("/questions/:id/answer", setAnswer);

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
    saveData();
    res.json({ success: true, message: "Answer submitted successfully", answer: newAnswer });
});

// =====================================================
// MEDIA
// =====================================================
// =====================================================
// MEDIA FILE STORAGE (saves files to disk)
// =====================================================
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

app.get("/media", (req, res) => res.json(mediaFiles));

app.post("/media", (req, res) => {
    const { type, data, fileName, opinion, expectedAnswer } = req.body;
    if (!type || !data || !fileName || !opinion)
        return res.status(400).json({ error: "All fields are required" });

    let fileUrl = null;
    try {
        // Save base64 data as actual file on disk
        const base64Data = data.includes(',') ? data.split(',')[1] : data;
        const ext = fileName.split('.').pop().toLowerCase() || (type === 'audio' ? 'mp3' : 'jpg');
        const uniqueName = `media_${Date.now()}.${ext}`;
        const filePath = path.join(UPLOADS_DIR, uniqueName);
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        fileUrl = `/uploads/${uniqueName}`;
    } catch(e) {
        console.error('File save error:', e.message);
        // fallback: store base64 if file save fails
        fileUrl = null;
    }

    const newMedia = {
        id: Date.now(), type,
        data: fileUrl || data,   // use URL if saved, else base64
        fileUrl,
        fileName, opinion,
        expectedAnswer: expectedAnswer || null, explanation: null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    mediaFiles.push(newMedia);
    saveData();
    res.json({ success: true, media: newMedia });
});

// Literal routes BEFORE parameterized /:id routes
app.get("/media/latest", (req, res) => {
    mediaFiles.length > 0 ? res.json(mediaFiles[mediaFiles.length - 1]) : res.status(404).json({ error: "No media" });
});

// Media text post (for bulk media schedule) — must be before /media/:id
app.post("/media/text", (req, res) => {
    const { question, answer, caption, urlOrText, type: reqType } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });

    // Detect type from passed type field, or caption filename, or data prefix
    let type = reqType || 'text';
    if (!reqType) {
        if (caption && caption.match(/\.(jpg|jpeg|png|gif|webp)$/i)) type = 'image';
        else if (caption && caption.match(/\.(mp3|wav|ogg|m4a|aac)$/i)) type = 'audio';
        else if (urlOrText && urlOrText.startsWith('data:image')) type = 'image';
        else if (urlOrText && urlOrText.startsWith('data:audio')) type = 'audio';
    }

    let fileUrl = null;
    // Save base64 to disk if it looks like file data
    if (urlOrText && (urlOrText.startsWith('data:') || urlOrText.length > 200)) {
        try {
            const base64Data = urlOrText.includes(',') ? urlOrText.split(',')[1] : urlOrText;
            const ext = caption ? caption.split('.').pop().toLowerCase() : (type === 'audio' ? 'mp3' : 'jpg');
            const uniqueName = `media_${Date.now()}.${ext}`;
            const filePath = path.join(UPLOADS_DIR, uniqueName);
            fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
            fileUrl = `/uploads/${uniqueName}`;
        } catch(e) {
            console.error('File save error:', e.message);
        }
    }

    const newMedia = {
        id: Date.now(), type,
        data: urlOrText || '',   // keep full base64 — always works even after redeploy
        fileUrl,
        fileName: caption || 'Media Item',
        opinion: question, expectedAnswer: answer || null, explanation: null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    mediaFiles.push(newMedia); saveData();
    res.json({ success: true, media: newMedia });
});

app.post("/media/:id/explanation", (req, res) => {
    const m = mediaFiles.find(m => m.id === parseInt(req.params.id));
    if (!m) return res.status(404).json({ error: "Not found" });
    m.explanation = req.body.explanation;
    saveData();
    res.json({ success: true, media: m });
});

app.delete("/media/:id", (req, res) => {
    const idx = mediaFiles.findIndex(m => m.id === parseInt(req.params.id));
    idx !== -1 ? (mediaFiles.splice(idx, 1), saveData(), res.json({ success: true })) : res.status(404).json({ error: "Not found" });
});

// =====================================================
// PHONES
// =====================================================
app.get("/phones", (req, res) => res.json(studentPhones));

app.post("/phones", (req, res) => {
    const { pin, name, phone } = req.body;
    if (!pin || !name || !phone) return res.status(400).json({ error: "All fields required" });
    studentPhones[pin] = { name, phone, lastLogin: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) };
    saveData();
    res.json({ success: true });
});

// =====================================================
// STATS / HEALTH
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

app.get("/api", (req, res) => res.json({ message: "TEJAPRATAP QUIZ API v5.0", status: "running" }));

app.post("/admin/reset-all", (req, res) => {
    const ADMIN_PASSWORD = process.env.ADMIN_RESET_PASSWORD;
    if (!ADMIN_PASSWORD) return res.status(500).json({ error: "Admin password not configured on server" });
    if (req.body.confirmPassword !== ADMIN_PASSWORD) return res.status(403).json({ error: "Wrong password" });
    questions = []; studentAnswers = []; mediaFiles = []; studentPhones = {};
    bulkSchedule = null; studentScores = {}; studentStreaks = {};
    wordItems = []; affairsItems = []; mediaSchedule = null; wordSchedule = null; affairsSchedule = null;
    saveData();
    res.json({ success: true, message: "All data reset" });
});

// =====================================================
// MEDIA SCHEDULE (separate from /schedule)
// =====================================================
app.get("/schedule/media", (req, res) => res.json(mediaSchedule || { empty: true }));
app.post("/schedule/media", (req, res) => { const { schedule } = req.body; if (!schedule) return res.status(400).json({ error: "Schedule required" }); mediaSchedule = schedule; saveData(); res.json({ success: true }); });
app.delete("/schedule/media", (req, res) => { mediaSchedule = null; saveData(); res.json({ success: true }); });
app.post("/schedule/media/mark-posted", (req, res) => {
    const { index, postedAt } = req.body;
    if (!mediaSchedule || !mediaSchedule.items || index === undefined) return res.status(400).json({ error: "Invalid" });
    if (mediaSchedule.items[index]) {
        mediaSchedule.items[index].posted = true;
        mediaSchedule.items[index].postedAt = postedAt || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        mediaSchedule.lastAutoPost = { day: index + 1, time: mediaSchedule.items[index].postedAt };
    }
    saveData(); res.json({ success: true });
});

// Set/update media expected answer
const setMediaAnswer = (req, res) => {
    const { expectedAnswer } = req.body;
    const m = mediaFiles.find(m => m.id === parseInt(req.params.id));
    if (!m) return res.status(404).json({ error: "Not found" });
    m.expectedAnswer = expectedAnswer;
    saveData(); res.json({ success: true, media: m });
};
app.put("/media/:id/answer", setMediaAnswer);
app.post("/media/:id/answer", setMediaAnswer);

// =====================================================
// WORD OF THE DAY
// =====================================================
app.get("/word", (req, res) => res.json(wordItems));

app.post("/word", (req, res) => {
    const { word, question, answer } = req.body;
    if (!word || !question) return res.status(400).json({ error: "Word and question required" });
    const item = { id: Date.now(), word, question, answer: (answer && answer.trim()) ? answer.trim() : null, date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) };
    wordItems.push(item); saveData();
    res.json({ success: true, item });
});

const setWordAnswer = (req, res) => {
    const { answer } = req.body;
    const w = wordItems.find(w => w.id === parseInt(req.params.id));
    if (!w) return res.status(404).json({ error: "Not found" });
    if (!answer || !answer.trim()) return res.status(400).json({ error: "Answer required" });
    w.answer = answer.trim(); saveData();
    res.json({ success: true, item: w });
};
app.put("/word/:id/answer", setWordAnswer);
app.post("/word/:id/answer", setWordAnswer);

app.get("/schedule/word", (req, res) => res.json(wordSchedule || { empty: true }));
app.post("/schedule/word", (req, res) => { const { schedule } = req.body; if (!schedule) return res.status(400).json({ error: "Required" }); wordSchedule = schedule; saveData(); res.json({ success: true }); });
app.delete("/schedule/word", (req, res) => { wordSchedule = null; saveData(); res.json({ success: true }); });
app.post("/schedule/word/mark-posted", (req, res) => {
    const { index, postedAt } = req.body;
    if (!wordSchedule || !wordSchedule.words || index === undefined) return res.status(400).json({ error: "Invalid" });
    if (wordSchedule.words[index]) {
        wordSchedule.words[index].posted = true;
        wordSchedule.words[index].postedAt = postedAt || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        wordSchedule.lastAutoPost = { day: index + 1, time: wordSchedule.words[index].postedAt };
    }
    saveData(); res.json({ success: true });
});

// =====================================================
// CURRENT AFFAIRS
// =====================================================
app.get("/affairs", (req, res) => res.json(affairsItems));

app.post("/affairs", (req, res) => {
    const { question, answer } = req.body;
    if (!question) return res.status(400).json({ error: "Question required" });
    const item = { id: Date.now(), question, answer: (answer && answer.trim()) ? answer.trim() : null, date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) };
    affairsItems.push(item); saveData();
    res.json({ success: true, item });
});

const setAffairsAnswer = (req, res) => {
    const { answer } = req.body;
    const a = affairsItems.find(a => a.id === parseInt(req.params.id));
    if (!a) return res.status(404).json({ error: "Not found" });
    if (!answer || !answer.trim()) return res.status(400).json({ error: "Answer required" });
    a.answer = answer.trim(); saveData();
    res.json({ success: true, item: a });
};
app.put("/affairs/:id/answer", setAffairsAnswer);
app.post("/affairs/:id/answer", setAffairsAnswer);

app.get("/schedule/affairs", (req, res) => res.json(affairsSchedule || { empty: true }));
app.post("/schedule/affairs", (req, res) => { const { schedule } = req.body; if (!schedule) return res.status(400).json({ error: "Required" }); affairsSchedule = schedule; saveData(); res.json({ success: true }); });
app.delete("/schedule/affairs", (req, res) => { affairsSchedule = null; saveData(); res.json({ success: true }); });
app.post("/schedule/affairs/mark-posted", (req, res) => {
    const { index, postedAt } = req.body;
    if (!affairsSchedule || !affairsSchedule.questions || index === undefined) return res.status(400).json({ error: "Invalid" });
    if (affairsSchedule.questions[index]) {
        affairsSchedule.questions[index].posted = true;
        affairsSchedule.questions[index].postedAt = postedAt || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        affairsSchedule.lastAutoPost = { day: index + 1, time: affairsSchedule.questions[index].postedAt };
    }
    saveData(); res.json({ success: true });
});

app.use(express.static(__dirname));
app.get("/", (req, res) => { const p = path.join(__dirname, "index.html"); fs.existsSync(p) ? res.sendFile(p) : res.status(500).send("index.html not found"); });
app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use((req, res) => res.status(404).json({ error: "Not found", path: req.path }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log("TEJAPRATAP QUIZ SERVER v5.0 on port " + PORT);
    console.log("App: http://localhost:" + PORT);
});
process.on("SIGTERM", () => { saveData(); server.close(() => console.log("Closed")); });
process.on("SIGINT", () => { saveData(); process.exit(0); });
module.exports = app;
