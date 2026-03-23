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
// TEACHER AUTH (server-side password check)
// =====================================================
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || "11223344@Ttp";
app.post("/auth/teacher", (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    if (password !== TEACHER_PASSWORD) return res.status(401).json({ error: "Wrong password" });
    res.json({ success: true });
});

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
            question: bulkSchedule.questions[index].question.length > 50
                ? bulkSchedule.questions[index].question.substring(0, 50) + "..."
                : bulkSchedule.questions[index].question,
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
    // Allow one score entry per date PER activity type — not just per date
    const activityType = req.body.activityType || 'general';
    const alreadyScored = studentScores[pin].scores.find(
        s => s.date === date && (s.activityType || 'general') === activityType
    );
    if (!alreadyScored) {
        studentScores[pin].scores.push({ date, points, activityType });
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
    const { question, answer, answerOpinion, questionFile, questionFileType, type } = req.body;
    if (!question) return res.status(400).json({ error: "Question is required" });
    const newQuestion = {
        id: Date.now(), question,
        answer: (answer && answer.trim()) ? answer.trim() : null,
        answerOpinion: (answerOpinion && answerOpinion.trim()) ? answerOpinion.trim() : null,
        questionFile: questionFile || null,
        questionFileType: questionFileType || null,
        type: type || null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    questions.push(newQuestion);
    saveData();
    res.json({ success: true, message: "Question posted successfully", question: newQuestion });
});

// ⚠️ IMPORTANT: /questions/reset MUST be before /questions/:id
// otherwise Express parses "reset" as an :id integer and returns 404
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

app.delete("/questions/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const idx = questions.findIndex(q => q.id === id);
    if (idx === -1) return res.status(404).json({ error: "Question not found" });
    questions.splice(idx, 1);
    // Also remove associated answers
    studentAnswers = studentAnswers.filter(a => a.questionId !== id);
    saveData();
    res.json({ success: true });
});

// =====================================================
// ANSWERS
// =====================================================
app.get("/answers", (req, res) => res.json(studentAnswers));

app.get("/answers/question/:questionId", (req, res) => {
    res.json(studentAnswers.filter(a => a.questionId === parseInt(req.params.questionId)));
});

app.post("/answers", (req, res) => {
    const { questionId, studentPin, studentName, answer, type } = req.body;
    if (questionId == null || !studentPin || !studentName || !answer)
        return res.status(400).json({ error: "All fields are required" });
    // FIX: coerce questionId to number on both sides — client may send string or number
    const qIdNum = Number(questionId);
    const existing = studentAnswers.find(a =>
        Number(a.questionId) === qIdNum && a.studentPin === studentPin &&
        (a.type || "question") === (type || "question")
    );
    if (existing) return res.status(400).json({ error: "You have already answered this" });
    const newAnswer = {
        id: Date.now(), questionId: qIdNum, studentPin, studentName, answer,
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
        data: fileUrl || data,   // prefer file URL, fall back to base64
        fileUrl,
        base64Backup: data,      // keep base64 so media still works after Render restarts wipe /uploads
        fileName, opinion,
        expectedAnswer: expectedAnswer || null, explanation: null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    mediaFiles.push(newMedia);
    saveData();
    res.json({ success: true, media: newMedia });
});

app.get("/media/latest", (req, res) => {
    mediaFiles.length > 0 ? res.json(mediaFiles[mediaFiles.length - 1]) : res.status(404).json({ error: "No media" });
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
    if (req.body.confirmPassword !== "RESET_ALL_DATA_TEJAPRATAP") return res.status(403).json({ error: "Wrong password" });
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

// Media text post (for bulk media schedule)
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
        data: fileUrl || urlOrText || '',  // prefer file URL, fall back to base64
        fileUrl,
        base64Backup: (urlOrText && urlOrText.length > 10) ? urlOrText : null, // survive Render restarts
        fileName: caption || 'Media Item',
        opinion: question, expectedAnswer: answer || null, explanation: null,
        date: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    };
    mediaFiles.push(newMedia); saveData();
    res.json({ success: true, media: newMedia });
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

// =====================================================
// TRANSCRIBE AUDIO (Speech-to-Text via Anthropic)
// =====================================================
app.post("/transcribe", async (req, res) => {
    const { audio, mimeType } = req.body;
    if (!audio) return res.status(400).json({ error: "No audio data" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

    let fetchFn = typeof fetch !== "undefined" ? fetch : null;
    if (!fetchFn) {
        try { const nf = await import("node-fetch"); fetchFn = nf.default || nf; }
        catch { return res.status(500).json({ error: "HTTP client unavailable" }); }
    }

    // Strip data URL prefix if present, keep only base64
    const base64Data = audio.includes(",") ? audio.split(",")[1] : audio;
    const mime = mimeType || "audio/webm";

    // NOTE: The Anthropic Claude API does not support audio as a document source.
    // We use a text-based prompt asking Claude to "transcribe" by treating the
    // base64 as a user-provided text blob. Since true audio transcription is not
    // supported, we return a fallback so the frontend uses the SR (Web Speech API) result.
    // If you want real transcription, integrate OpenAI Whisper or Google Speech-to-Text.
    console.log("[Transcribe] Audio transcription via Claude API is not supported for audio MIME types. Returning empty so frontend uses browser SR result.");
    return res.status(422).json({ error: "Audio transcription not supported — browser speech recognition will be used instead." });
});

// =====================================================
// AI GRAMMAR CHECK
// =====================================================
app.post("/ai/grammar", async (req, res) => {
    const { text } = req.body;
    if (!text || text.trim().length < 5)
        return res.status(400).json({ error: "Text too short" });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey)
        return res.status(500).json({ error: "ANTHROPIC_API_KEY not set. Add it in Render → Environment Variables." });

    let fetchFn = typeof fetch !== "undefined" ? fetch : null;
    if (!fetchFn) {
        try { const nf = await import("node-fetch"); fetchFn = nf.default || nf; }
        catch { return res.status(500).json({ error: "HTTP client unavailable. Run: npm install node-fetch" }); }
    }

    const studentText = text.trim();

    // ─── PASS 1: Think deeply, find every error (free-form reasoning) ───────────
    const PASS1_SYSTEM = `You are the strictest English grammar examiner in India, checking spoken English from polytechnic students. Your reputation depends on finding EVERY single mistake — missing even one error is unacceptable.

Go through the student's text WORD BY WORD and check each of the following categories:

TENSE ERRORS
- Wrong past tense: "I goed" → "I went", "he catched" → "he caught", "she cooked" ✓
- Present continuous misuse: "I am knowing", "she is having", "we are understanding", "I am wanting"
- Present perfect errors: "I have went", "he has came", "they have ate"
- Simple present for ongoing: "yesterday I go to market" → "I went to market"

ARTICLE ERRORS (a / an / the / missing)
- "I went to market" → "I went to the market"
- "she is good girl" → "she is a good girl"
- "I have suggestion" → "I have a suggestion"
- Wrong article: "a honest man" → "an honest man", "an university" → "a university"

SUBJECT-VERB AGREEMENT
- "he don't know" → "he doesn't know"
- "they was playing" → "they were playing"
- "she have two books" → "she has two books"
- "we goes to school" → "we go to school"

PREPOSITION ERRORS
- "discuss about" → "discuss" (no 'about')
- "cope up with" → "cope with"
- "return back" → "return"
- "reach to the station" → "reach the station"
- "married with" → "married to"
- "superior than" → "superior to"

REDUNDANCY / WRONG WORDS
- "revert back" → "revert"
- "repeat again" → "repeat"
- "prepone" (not a word) → "reschedule to an earlier time"
- "do the needful" → "do what is needed"
- "today morning" → "this morning"
- "off" instead of "turn off": "off the light" → "turn off the light"

PLURAL ERRORS
- "furnitures" → "furniture"
- "informations" → "information"
- "advices" → "advice"
- "equipments" → "equipment"
- "staffs" → "staff"

WORD ORDER
- "I daily go to college" → "I go to college daily"
- "she always is late" → "she is always late"
- "I too want it" → "I want it too"

VOCABULARY / WORD CHOICE
- "He expired" → "He passed away" (expired is for food/documents)
- "I told to him" → "I told him"
- "very much interested" → "very interested"
- "kind-heartedly" (awkward) → "kindly"

List EVERY mistake you find. Be thorough. Do not excuse any error, even if the meaning is still clear.`;

    const PASS1_USER = `Student's spoken text:
"${studentText}"

Go through this text word by word. List every single grammar mistake you find. For each mistake write:
- WRONG: [exact words from student text]
- RIGHT: [corrected version]
- RULE: [why it is wrong, explained simply]
- TYPE: [Tense / Article / Agreement / Preposition / Redundancy / Plural / WordOrder / Vocabulary / Other]

After listing all mistakes, write the fully corrected version of the entire text.
Then give a grammar score from 0–100 (100 = perfect English, 0 = very poor).
Then give 2 practical improvement tips for this student.
Then give 1–2 pronunciation tips relevant to Indian English speakers.`;

    // ─── PASS 2: Convert Pass 1 analysis into strict JSON ───────────────────────
    const PASS2_SYSTEM = `You convert English grammar analysis reports into clean JSON. You output ONLY raw JSON — no markdown, no backticks, no explanation, nothing outside the JSON object.`;

    const PASS2_USER_TEMPLATE = (analysis, original) => `Here is a grammar analysis of a student's spoken text.

Original student text:
"${original}"

Grammar analysis:
${analysis}

Convert this into EXACTLY this JSON format. Copy the "wrong" phrases EXACTLY as they appear in the original student text (do not paraphrase):

{
  "corrected": "the fully corrected version of the entire student text",
  "score": <number 0-100>,
  "errors": [
    {
      "wrong": "exact phrase from student text",
      "right": "corrected phrase",
      "rule": "simple explanation",
      "type": "Tense|Article|Agreement|Preposition|Redundancy|Plural|WordOrder|Vocabulary|Other"
    }
  ],
  "suggestions": ["tip 1", "tip 2"],
  "pronunciation_tips": ["tip 1"]
}

Rules:
- Include ALL errors from the analysis above — do not drop any
- "wrong" must be copied character-for-character from the original student text
- If no errors were found, return an empty errors array and score 95–100
- Output ONLY the JSON object, nothing else`;

    let lastErr = "";

    try {
        // ── Pass 1: Deep analysis ──────────────────────────────────────────────
        console.log(`[AI-P1] Analyzing ${studentText.length} chars`);
        const ctrl1 = new AbortController();
        const t1 = setTimeout(() => ctrl1.abort(), 35000);

        const r1 = await fetchFn("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 2500,
                system: PASS1_SYSTEM,
                messages: [{ role: "user", content: PASS1_USER }]
            }),
            signal: ctrl1.signal
        });
        clearTimeout(t1);

        if (!r1.ok) {
            const errBody = await r1.text();
            lastErr = `Pass1 API HTTP ${r1.status}: ${errBody.substring(0, 200)}`;
            console.error("[AI-P1]", lastErr);
            throw new Error(lastErr);
        }

        const d1 = await r1.json();
        const analysis = d1?.content?.[0]?.text || "";
        console.log(`[AI-P1] Analysis (${analysis.length} chars):`, analysis.substring(0, 200));

        if (!analysis || analysis.length < 10) throw new Error("Pass 1 returned empty analysis");

        // ── Pass 2: Convert analysis to JSON ───────────────────────────────────
        console.log(`[AI-P2] Converting analysis to JSON`);
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 25000);

        const r2 = await fetchFn("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 2000,
                system: PASS2_SYSTEM,
                messages: [{ role: "user", content: PASS2_USER_TEMPLATE(analysis, studentText) }]
            }),
            signal: ctrl2.signal
        });
        clearTimeout(t2);

        if (!r2.ok) {
            const errBody = await r2.text();
            lastErr = `Pass2 API HTTP ${r2.status}: ${errBody.substring(0, 200)}`;
            console.error("[AI-P2]", lastErr);
            throw new Error(lastErr);
        }

        const d2 = await r2.json();
        const raw2 = d2?.content?.[0]?.text || "";
        console.log(`[AI-P2] Raw JSON (${raw2.length} chars):`, raw2.substring(0, 150));

        // Robust JSON extraction
        const cleaned = raw2.replace(/```json|```/g, "").trim();
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Pass 2 returned no JSON: " + raw2.substring(0, 100));

        const parsed = JSON.parse(match[0]);

        return res.json({
            corrected:          typeof parsed.corrected === "string" ? parsed.corrected : studentText,
            errors:             Array.isArray(parsed.errors) ? parsed.errors.filter(e => e && e.wrong && e.right) : [],
            score:              typeof parsed.score === "number" ? Math.min(100, Math.max(0, parsed.score)) : 70,
            suggestions:        Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean) : [],
            pronunciation_tips: Array.isArray(parsed.pronunciation_tips) ? parsed.pronunciation_tips.filter(Boolean) : [],
            _analysis:          analysis  // kept for server-side debugging (not shown to student)
        });

    } catch (e) {
        lastErr = e.name === "AbortError" ? "Timed out" : e.message;
        console.error("[AI-GRAMMAR] Failed:", lastErr);
        return res.status(500).json({ error: lastErr });
    }
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
