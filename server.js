const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// In-memory storage
let questions = [];
let studentAnswers = [];
let mediaFiles = [];
let studentPhones = {};

// ============ QUESTIONS ENDPOINTS ============

app.get("/questions", (req, res) => {
    res.json(questions);
});

app.post("/questions", (req, res) => {
    const { question, answer } = req.body;
    
    if (!question) {
        return res.status(400).json({ error: "Question is required" });
    }
    
    if (answer && questions.length > 0) {
        questions[questions.length - 1].answer = answer;
    }
    
    const newQuestion = {
        id: Date.now(),
        question,
        answer: null,
        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };
    
    questions.push(newQuestion);
    
    res.json({ 
        success: true, 
        message: "Question posted successfully",
        question: newQuestion
    });
});

app.get("/questions/:id", (req, res) => {
    const question = questions.find(q => q.id === parseInt(req.params.id));
    if (question) {
        res.json(question);
    } else {
        res.status(404).json({ error: "Question not found" });
    }
});

app.put("/questions/:id/answer", (req, res) => {
    const { answer } = req.body;
    const question = questions.find(q => q.id === parseInt(req.params.id));
    
    if (question) {
        question.answer = answer;
        res.json({ success: true, question });
    } else {
        res.status(404).json({ error: "Question not found" });
    }
});

app.delete("/questions/reset", (req, res) => {
    questions = [];
    res.json({ success: true, message: "All questions deleted" });
});

// ============ STUDENT ANSWERS ENDPOINTS ============

app.get("/answers", (req, res) => {
    res.json(studentAnswers);
});

app.get("/answers/question/:questionId", (req, res) => {
    const answers = studentAnswers.filter(a => a.questionId === parseInt(req.params.questionId));
    res.json(answers);
});

app.post("/answers", (req, res) => {
    const { questionId, studentPin, studentName, answer, type } = req.body;
    
    if (!questionId || !studentPin || !studentName || !answer) {
        return res.status(400).json({ error: "All fields are required" });
    }
    
    const existingAnswer = studentAnswers.find(
        a => a.questionId === questionId && 
             a.studentPin === studentPin &&
             (a.type || 'question') === (type || 'question')
    );
    
    if (existingAnswer) {
        return res.status(400).json({ 
            error: "You have already answered this" 
        });
    }
    
    const newAnswer = {
        id: Date.now(),
        questionId,
        studentPin,
        studentName,
        answer,
        type: type || 'question',
        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };
    
    studentAnswers.push(newAnswer);
    
    res.json({ 
        success: true, 
        message: "Answer submitted successfully",
        answer: newAnswer
    });
});

// ============ MEDIA FILES ENDPOINTS ============

app.get("/media", (req, res) => {
    res.json(mediaFiles);
});

app.post("/media", (req, res) => {
    const { type, data, fileName, opinion } = req.body;
    
    if (!type || !data || !fileName || !opinion) {
        return res.status(400).json({ error: "All fields are required" });
    }
    
    const newMedia = {
        id: Date.now(),
        type,
        data,
        fileName,
        opinion,
        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };
    
    mediaFiles.push(newMedia);
    
    res.json({ 
        success: true, 
        message: "Media uploaded successfully",
        media: newMedia
    });
});

app.get("/media/latest", (req, res) => {
    if (mediaFiles.length > 0) {
        res.json(mediaFiles[mediaFiles.length - 1]);
    } else {
        res.status(404).json({ error: "No media files found" });
    }
});

app.delete("/media/:id", (req, res) => {
    const mediaIndex = mediaFiles.findIndex(m => m.id === parseInt(req.params.id));
    
    if (mediaIndex !== -1) {
        mediaFiles.splice(mediaIndex, 1);
        res.json({ success: true, message: "Media deleted successfully" });
    } else {
        res.status(404).json({ error: "Media not found" });
    }
});

// ============ STUDENT PHONES ENDPOINTS ============

app.get("/phones", (req, res) => {
    res.json(studentPhones);
});

app.post("/phones", (req, res) => {
    const { pin, name, phone } = req.body;
    
    if (!pin || !name || !phone) {
        return res.status(400).json({ error: "All fields are required" });
    }
    
    studentPhones[pin] = {
        name,
        phone,
        lastLogin: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };
    
    res.json({ 
        success: true, 
        message: "Phone registered successfully" 
    });
});

// ============ STATISTICS ENDPOINTS ============

app.get("/stats", (req, res) => {
    const stats = {
        totalQuestions: questions.length,
        totalAnswers: studentAnswers.length,
        totalMedia: mediaFiles.length,
        totalStudents: Object.keys(studentPhones).length,
        uniqueStudents: [...new Set(studentAnswers.map(a => a.studentPin))].length,
        latestQuestionDate: questions.length > 0 ? questions[questions.length - 1].date : null,
        latestMediaDate: mediaFiles.length > 0 ? mediaFiles[mediaFiles.length - 1].date : null,
        questionAnswers: studentAnswers.filter(a => (!a.type || a.type === 'question')).length,
        mediaAnswers: studentAnswers.filter(a => a.type === 'media').length
    };
    
    res.json(stats);
});

// ============ ADMIN/RESET ENDPOINTS ============

app.post("/admin/reset-all", (req, res) => {
    const { confirmPassword } = req.body;
    
    if (confirmPassword !== "RESET_ALL_DATA_TEJAPRATAP") {
        return res.status(403).json({ error: "Incorrect confirmation password" });
    }
    
    questions = [];
    studentAnswers = [];
    mediaFiles = [];
    studentPhones = {};
    
    res.json({ 
        success: true, 
        message: "All data has been reset" 
    });
});

// ============ HEALTH CHECK & INFO ============

// API info endpoint - MUST come before root route
app.get("/api", (req, res) => {
    res.json({ 
        message: "TEJAPRATAP'S QUIZ API",
        status: "running",
        version: "2.1.0",
        description: "Learn something new every day!",
        endpoints: {
            questions: "/questions",
            answers: "/answers (supports type: 'question' or 'media')",
            media: "/media",
            phones: "/phones",
            stats: "/stats"
        },
        features: [
            "Daily questions",
            "Media uploads (images/audio)",
            "Student responses to media",
            "Phone number tracking",
            "Real-time synchronization"
        ]
    });
});

app.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        dataStats: {
            questions: questions.length,
            answers: studentAnswers.length,
            media: mediaFiles.length,
            students: Object.keys(studentPhones).length
        }
    });
});

// ============ SERVE HTML APP ============

// Serve static files AFTER API routes
app.use(express.static(__dirname));

// Root endpoint - serve the HTML app
app.get("/", (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    console.log('Serving index.html from:', indexPath);
    console.log('File exists?', fs.existsSync(indexPath));
    
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        console.error('index.html not found at:', indexPath);
        console.error('Directory contents:', fs.readdirSync(__dirname));
        res.status(500).send(`
            <h1>Error: index.html not found</h1>
            <p>Path: ${indexPath}</p>
            <p>Try visiting <a href="/app">/app</a> instead</p>
        `);
    }
});

// Alternative route
app.get("/app", (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: "Endpoint not found",
        message: "Please check the API documentation",
        requestedPath: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: "Internal server error",
        message: err.message 
    });
});

// ============ SERVER START ============

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════╗
║     TEJAPRATAP'S QUIZ SERVER              ║
║     Learn something new every day!        ║
║     Server running on port ${PORT}          ║
╚═══════════════════════════════════════════╝
    `);
    console.log(`\n📡 API URL: http://localhost:${PORT}`);
    console.log(`🌐 Web App: http://localhost:${PORT}/app`);
    console.log(`\n📊 Available Endpoints:`);
    console.log(`   GET  /questions - Get all questions`);
    console.log(`   POST /questions - Post new question`);
    console.log(`   GET  /answers - Get all answers`);
    console.log(`   POST /answers - Submit answer (question or media)`);
    console.log(`   GET  /media - Get all media`);
    console.log(`   POST /media - Upload media`);
    console.log(`   GET  /media/latest - Get latest media`);
    console.log(`   GET  /phones - Get student phones`);
    console.log(`   POST /phones - Register phone`);
    console.log(`   GET  /stats - Get statistics`);
    console.log(`   GET  /health - Health check\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});

module.exports = app;
