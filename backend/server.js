require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json({ limit: '100mb' }));

const SECRET_KEY      = process.env.SECRET_KEY      || 'vitalrush-super-secret-key';
const JWT_SECRET      = process.env.JWT_SECRET      || 'vitalrush-jwt-secret';
const rawAdmin        = process.env.ADMIN_PASSWORD;
const ADMIN_PASSWORD  = (rawAdmin !== undefined && rawAdmin !== '') ? rawAdmin.replace(/['"]/g, '').trim() : 'medicrisis-admin-2026';
const rawGeminiKey    = process.env.GEMINI_API_KEY  || '';
const GEMINI_API_KEY  = rawGeminiKey.replace(/['"]/g, '').trim();
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';

const dbConfig = { host: 'localhost', user: 'root', password: '', database: 'medicrisis_db' };
let pool;

async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('Database connected successfully.');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS leaderboard (
                id               INT AUTO_INCREMENT PRIMARY KEY,
                player_name      VARCHAR(255) NOT NULL,
                integrity_score  INT          NOT NULL,
                duration_seconds INT          NOT NULL,
                surgery_status   VARCHAR(50)  NOT NULL,
                hospital_id      VARCHAR(100) DEFAULT 'public',
                user_id          VARCHAR(100) DEFAULT 'anonymous',
                ai_debrief       TEXT         DEFAULT NULL,
                phase_failed     VARCHAR(200) DEFAULT NULL,
                created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user     (user_id),
                INDEX idx_hospital (hospital_id),
                INDEX idx_score    (integrity_score DESC)
            )
        `);

        // Non-destructive migrations
        for (const sql of [
            "ALTER TABLE leaderboard ADD COLUMN hospital_id    VARCHAR(100) DEFAULT 'public'",
            "ALTER TABLE leaderboard ADD COLUMN user_id        VARCHAR(100) DEFAULT 'anonymous'",
            "ALTER TABLE leaderboard ADD COLUMN ai_debrief     TEXT         DEFAULT NULL",
            "ALTER TABLE leaderboard ADD COLUMN phase_failed   VARCHAR(200) DEFAULT NULL",
            "ALTER TABLE leaderboard ADD INDEX  idx_hospital   (hospital_id)",
            "ALTER TABLE leaderboard ADD INDEX  idx_user       (user_id)",
            "ALTER TABLE leaderboard ADD INDEX  idx_score      (integrity_score DESC)",
        ]) { try { await pool.query(sql); } catch (_) {} }

    } catch (error) { console.error('Database initialization failed:', error); }
}
initDB();

// ─── AI Helpers ──────────────────────────────────────────────────────────────
async function generateDebrief(payload) {
    if (!GEMINI_API_KEY) return 'AI Debrief unavailable (No API Key).';
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(
            `You are an expert Chief Surgeon reviewing a VR medical simulation.
Patient data: ${JSON.stringify(payload)}
Generate a short, concise, conversational post-op review. Clinical, direct tone. Max 3 sentences.`
        );
        return result.response.text();
    } catch (e) {
        console.error('Gemini Error:', e);
        return 'System was unable to generate a debrief for this session.';
    }
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth) return res.status(401).json({ error: 'Missing Authorization' });
    try {
        const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
        next();
    } catch { return res.status(403).json({ error: 'Invalid token' }); }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// 1. Authenticate VR Headset
app.post('/api/auth', (req, res) => {
    const { deviceId, hospitalId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Missing deviceId' });
    const token = jwt.sign({ deviceId, hospitalId: hospitalId || 'public' }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token });
});

// 2. Admin Login
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (!password || password !== ADMIN_PASSWORD)
        return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, role: 'admin' });
});

// 3. Submit Telemetry
app.post('/api/telemetry', async (req, res) => {
    try {
        const auth = req.headers['authorization'];
        if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });
        let decoded;
        try { decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET); }
        catch { return res.status(403).json({ error: 'Invalid or expired session token' }); }

        const payload     = req.body;
        const clientHash  = req.headers['x-signature'];
        const serverHash  = crypto.createHmac('sha256', SECRET_KEY).update(JSON.stringify(payload)).digest('hex');
        if (!clientHash || clientHash !== serverHash)
            console.warn('⚠️  CRYPTO MISMATCH — bypassing for local testing.');

        const aiDebrief  = await generateDebrief(payload);
        const hospitalId = decoded.hospitalId;
        const phaseFailed = payload.phase_failed || null;

        await pool.query(
            `INSERT INTO leaderboard
             (player_name, integrity_score, duration_seconds, surgery_status, hospital_id, ai_debrief, phase_failed)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [payload.player_name, payload.integrity_score, payload.duration_seconds,
             payload.surgery_status, hospitalId, aiDebrief, phaseFailed]
        );

        const newRecord = { ...payload, hospital_id: hospitalId, ai_debrief: aiDebrief };
        io.to(hospitalId).emit('new_score', newRecord);
        io.to('public').emit('new_score', newRecord);

        res.status(201).json({ status: 'success', debrief: aiDebrief });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// 4. Fetch Leaderboard (REST + multi-tenant)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const hospitalId = req.query.hospital_id || 'public';
        const isGlobal   = hospitalId === 'public';
        const [rows] = await pool.query(
            isGlobal
                ? `SELECT id, player_name, integrity_score, duration_seconds, surgery_status,
                          hospital_id, ai_debrief, phase_failed, created_at
                   FROM leaderboard ORDER BY integrity_score DESC, duration_seconds ASC LIMIT 100`
                : `SELECT id, player_name, integrity_score, duration_seconds, surgery_status,
                          hospital_id, ai_debrief, phase_failed, created_at
                   FROM leaderboard WHERE hospital_id = ?
                   ORDER BY integrity_score DESC, duration_seconds ASC LIMIT 100`,
            isGlobal ? [] : [hospitalId]
        );
        res.json(rows);
    } catch { res.status(500).json({ error: 'Database query failed' }); }
});

// 5. Surgeon History (last 10 sessions — trend chart)
app.get('/api/surgeon/:name/history', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT integrity_score, duration_seconds, surgery_status, phase_failed, created_at
             FROM leaderboard WHERE player_name = ?
             ORDER BY created_at DESC LIMIT 10`,
            [req.params.name]
        );
        res.json(rows.reverse());
    } catch { res.status(500).json({ error: 'Database query failed' }); }
});

// 6. AI Trend Analysis (Surgeon Profile page)
app.post('/api/trend-analysis', async (req, res) => {
    try {
        const { player_name, sessions } = req.body;
        if (!sessions?.length) return res.status(400).json({ error: 'No session data' });
        if (!GEMINI_API_KEY)   return res.json({ analysis: 'AI analysis unavailable.' });

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(
            `You are a Chief Medical Officer reviewing a surgical resident's career performance.
Surgeon: ${player_name}
Last ${sessions.length} sessions: ${JSON.stringify(sessions)}

Write a personalized "Areas of Improvement" career trajectory summary in 3 short paragraphs:
1. Overall performance assessment
2. Key strengths and patterns
3. Specific actionable recommendations
Be direct, clinical, and constructive. Address the surgeon by name.`
        );
        res.json({ analysis: result.response.text() });
    } catch (e) { console.error('Trend Analysis Error:', e); res.status(500).json({ error: 'AI analysis failed' }); }
});

// 7. TTS — Deepgram audio for modal playback
app.post('/api/tts', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || !DEEPGRAM_API_KEY) return res.status(400).json({ error: 'TTS unavailable' });

        const dgRes = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
            method: 'POST',
            headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!dgRes.ok) return res.status(500).json({ error: 'Deepgram error' });
        const buf = await dgRes.arrayBuffer();
        res.json({ audio: Buffer.from(buf).toString('base64') });
    } catch { res.status(500).json({ error: 'TTS failed' }); }
});

// 8. CSV Export (Admin only)
app.get('/api/export/csv', requireAdmin, async (req, res) => {
    try {
        const hospitalId = req.query.hospital_id || 'public';
        const isGlobal   = hospitalId === 'public';
        const [rows] = await pool.query(
            isGlobal
                ? `SELECT id, player_name, integrity_score, duration_seconds, surgery_status,
                          hospital_id, phase_failed, created_at FROM leaderboard ORDER BY created_at DESC`
                : `SELECT id, player_name, integrity_score, duration_seconds, surgery_status,
                          hospital_id, phase_failed, created_at FROM leaderboard
                   WHERE hospital_id = ? ORDER BY created_at DESC`,
            isGlobal ? [] : [hospitalId]
        );

        const header = ['ID','Player Name','Integrity Score','Duration (sec)','Status','Hospital ID','Phase Failed','Timestamp'].join(',');
        const csv    = [header, ...rows.map(r =>
            [r.id, `"${r.player_name}"`, r.integrity_score, r.duration_seconds,
             r.surgery_status, r.hospital_id, r.phase_failed || '', r.created_at].join(',')
        )].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="medicrisis_leaderboard.csv"');
        res.send(csv);
    } catch { res.status(500).json({ error: 'Export failed' }); }
});

// 9. Admin — full leaderboard with all fields
app.get('/api/admin/leaderboard', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT * FROM leaderboard ORDER BY created_at DESC LIMIT 500`
        );
        res.json(rows);
    } catch { res.status(500).json({ error: 'Database query failed' }); }
});

// 10. Evaluate Surgery (multimodal — unchanged)
app.post('/api/evaluate-surgery', async (req, res) => {
    try {
        const { currentState, base64Image, base64Audio } = req.body;
        if (!base64Image || !base64Audio)
            return res.status(400).json({ error: 'Missing image or audio payload from VR.' });

        const cleanImageBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
        const cleanAudioBase64 = base64Audio.replace(/^data:audio\/\w+;base64,/, '');

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        let dynamicStateMachine = '';
        if (currentState === 'PreOp_AwaitingScalpel' || !currentState) {
            dynamicStateMachine = `
            STATE 1: VISUAL CONTRABAND CHECK
            - Check: Is the user holding any tool (Scissors, Forceps, or Scalpel)?
            - If Fail: "Protocol Violation. Your hands must be completely empty before initializing a new state sequence."
            STATE 2: ACTION REQUIRED
            - Check: Always fail this state.
            - Instruction: "Surgical field reset. Reach out and firmly grasp the Scalpel to initiate Phase 1."`;
        } else if (currentState.includes('Phase4') || currentState.includes('Phase5') || currentState.includes('Phase7')) {
            dynamicStateMachine = `
            STATE 5: EXCISION TOOL ACQUISITION
            - Check: Is the user holding the surgical Scissors?
            - If Fail: "Scalpel incision complete. Locate and equip the surgical scissors from the tray."`;
        } else {
            dynamicStateMachine = `
            STATE 3: ALIGNMENT & PROXIMITY
            - Check ONLY: Is the Scalpel tip positioned too high or far from the Incision Target?
            - If Fail: "Scalpel acquisition verified. Lower the blade tip until it is directly above the central incision crease."`;
        }

        const systemPrompt = `You are the MediCrisis Core, a zero-tolerance AI Surgical Director.
[0. C# GROUND TRUTH] Unity Physics Engine reports: ${currentState || 'Unknown State'}
${dynamicStateMachine}
[RESPONSE FORMAT]
 If Intent = GENERAL_QUESTION: TYPE: SYSTEM \n MESSAGE: [Answer]
 If Intent = GUIDANCE: TYPE: GUIDANCE \n MESSAGE: [Instructions]
 If Intent = EVALUATION: TYPE: EVALUATION \n SCORE: [0-100] \n FEEDBACK: [Paragraph]`;

        const result = await model.generateContent([
            systemPrompt,
            { inlineData: { data: cleanImageBase64, mimeType: 'image/jpeg' } },
            { inlineData: { data: cleanAudioBase64, mimeType: 'audio/wav' } }
        ]);
        const responseText = result.response.text();

        let aiAudioBase64 = '';
        if (DEEPGRAM_API_KEY) {
            try {
                const spokenText = responseText.replace(/TYPE:.*\n/gi,'').replace(/MESSAGE:|SCORE:|FEEDBACK:/gi,'').trim();
                const dgRes = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
                    method: 'POST',
                    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: spokenText })
                });
                if (dgRes.ok) {
                    const buf = await dgRes.arrayBuffer();
                    aiAudioBase64 = Buffer.from(buf).toString('base64');
                }
            } catch (err) { console.error('Deepgram Error:', err); }
        }

        res.status(200).json({ response: responseText, aiAudioBase64 });
    } catch { res.status(500).json({ error: 'Failed to connect to AI Core.' }); }
});

// 11. Shutdown Server
app.post('/api/shutdown', (req, res) => {
    res.json({ success: true, message: 'Server shutting down' });
    setTimeout(() => {
        process.exit(0);
    }, 500);
});

// WebSocket Connection
io.on('connection', (socket) => {
    socket.on('join_tenant', (hospitalId) => socket.join(hospitalId));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Real-Time Infrastructure listening on port ${PORT}`));