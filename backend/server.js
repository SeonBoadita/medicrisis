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
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Configuration
const SECRET_KEY = process.env.SECRET_KEY || 'vitalrush-super-secret-key';
const JWT_SECRET = process.env.JWT_SECRET || 'vitalrush-jwt-secret';
// The Architect's Sanitizer: Strips hidden Windows line breaks and literal quotes
const rawGeminiKey = process.env.GEMINI_API_KEY || '';
const GEMINI_API_KEY = rawGeminiKey.replace(/['"]/g, '').trim();

console.log(`[SYS-CHECK] Raw Length: ${rawGeminiKey.length} | Sanitized Length: ${GEMINI_API_KEY.length}`);
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || '';

// Database Connection
const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'medicrisis_db'
};

let pool;

async function initDB() {
    try {
        pool = mysql.createPool(dbConfig);
        console.log('Database connected successfully.');

        // Initialize table if it doesn't exist, and add hospital_id for multi-tenancy
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS leaderboard (
                id INT AUTO_INCREMENT PRIMARY KEY,
                player_name VARCHAR(255) NOT NULL,
                integrity_score INT NOT NULL,
                duration_seconds INT NOT NULL,
                surgery_status VARCHAR(50) NOT NULL,
                hospital_id VARCHAR(100) DEFAULT 'public',
                user_id VARCHAR(100) DEFAULT 'anonymous',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_user (user_id),
                INDEX idx_hospital (hospital_id),
                INDEX idx_score (integrity_score DESC)
            )
        `;
        await pool.query(createTableQuery);

        // Try adding hospital_id to existing table if it was created without it
        try {
            await pool.query("ALTER TABLE leaderboard ADD COLUMN hospital_id VARCHAR(100) DEFAULT 'public'");
            await pool.query("ALTER TABLE leaderboard ADD COLUMN user_id VARCHAR(100) DEFAULT 'anonymous'");
            await pool.query("ALTER TABLE leaderboard ADD INDEX idx_hospital (hospital_id)");
            await pool.query("ALTER TABLE leaderboard ADD INDEX idx_user (user_id)");
            await pool.query("ALTER TABLE leaderboard ADD INDEX idx_score (integrity_score DESC)");
        } catch (e) {
            // Columns likely already exist
        }

    } catch (error) {
        console.error('Database initialization failed:', error);
    }
}

initDB();

// Generative AI Debrief
async function generateDebrief(payload) {
    if (!GEMINI_API_KEY) return "AI Debrief unavailable (No API Key).";
    try {
        // The Architect's Override: Force-feed the key to bypass dotenvx parsing failures
        if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 10) {
            throw new Error("CRITICAL: API Key is structurally invalid before hitting SDK.");
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        // Explicitly pass the apiKey in the model config as a failsafe
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            // We are forcing the SDK to accept this string, ignoring its internal env check
            apiKey: GEMINI_API_KEY
        });
        const prompt = `You are an expert Chief Surgeon reviewing a VR medical simulation telemetry.
Patient data: ${JSON.stringify(payload)}
Generate a short, concise, custom conversational post-op review for this session. Use a clinical, direct tone. (Max 3 sentences).`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.error("Gemini Error:", e);
        return "System was unable to generate a debrief for this session due to a network error.";
    }
}

// Routes
// 1. Authenticate VR Headset (returns JWT)
app.post('/api/auth', (req, res) => {
    const { deviceId, hospitalId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });

    const token = jwt.sign({ deviceId, hospitalId: hospitalId || 'public' }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ token });
});

// 2. Submit Telemetry (Secure Pipeline)
app.post('/api/telemetry', async (req, res) => {
    try {
        // A. JWT Authentication
        const authHeader = req.headers['authorization'];
        if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });
        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(403).json({ error: "Invalid or expired session token" });
        }

        const payload = req.body;

        // B. Payload Cryptography (HMAC Verification)
        const clientHash = req.headers['x-signature'];
        const payloadString = JSON.stringify(payload);
        const serverHash = crypto.createHmac('sha256', SECRET_KEY).update(payloadString).digest('hex');

        if (!clientHash || clientHash !== serverHash) {
            return res.status(403).json({ error: "Payload tamper detected. Signature mismatch." });
        }

        // C. Heuristic Validation (Anti-Cheat)
        if (payload.duration_seconds < 45) {
            console.log(`[Anti-Cheat] Flagged physically impossible duration: ${payload.duration_seconds}s for ${payload.player_name}`);
            return res.status(400).json({ error: "Session flagged by Anti-Cheat: Duration too short." });
        }

        // Generate AI Debrief
        const aiDebrief = await generateDebrief(payload);

        // D. Multi-Tenant Database Insert
        const hospitalId = decoded.hospitalId;
        const query = "INSERT INTO leaderboard (player_name, integrity_score, duration_seconds, surgery_status, hospital_id) VALUES (?, ?, ?, ?, ?)";
        await pool.query(query, [
            payload.player_name,
            payload.integrity_score,
            payload.duration_seconds,
            payload.surgery_status,
            hospitalId
        ]);

        // E. Live Socket Broadcast
        const newRecord = { ...payload, hospital_id: hospitalId, ai_debrief: aiDebrief };
        io.to(hospitalId).emit('new_score', newRecord);
        io.to('public').emit('new_score', newRecord);

        res.status(201).json({ status: "success", debrief: aiDebrief });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// 3. Fetch Leaderboard (REST fallback)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const hospitalId = req.query.hospital_id || 'public';
        let query = "SELECT player_name, integrity_score, duration_seconds, surgery_status FROM leaderboard ORDER BY integrity_score DESC, duration_seconds ASC LIMIT 100";
        let params = [];

        // Multi-tenant isolation logic
        if (hospitalId !== 'public') {
            query = "SELECT player_name, integrity_score, duration_seconds, surgery_status FROM leaderboard WHERE hospital_id = ? ORDER BY integrity_score DESC, duration_seconds ASC LIMIT 100";
            params = [hospitalId];
        }

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: "Database query failed" });
    }
});

// 4. Evaluate Surgery (Ground Truth State Machine + Deepgram TTS)
app.post('/api/evaluate-surgery', async (req, res) => {
    try {
        const { currentState, base64Image, base64Audio } = req.body;

        if (!base64Image || !base64Audio) {
            return res.status(400).json({ error: "Missing image or audio payload from VR." });
        }

        console.log(`MediCrisis Core: Receiving Payload. State: [${currentState || 'Unknown'}]...`);

        const cleanImageBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
        const cleanAudioBase64 = base64Audio.replace(/^data:audio\/\w+;base64,/, "");

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // ==========================================
        // THE ARCHITECT'S GROUND TRUTH ENFORCEMENT
        // ==========================================
        let dynamicStateMachine = "";

        if (currentState === "PreOp_AwaitingScalpel" || !currentState) {
            console.log("MediCrisis Core: Engine reports tool is DROPPED. Hard-locking AI to Pre-Op Evaluation.");
            dynamicStateMachine = `
            STATE 1: VISUAL CONTRABAND CHECK
            - Check: Is the user holding any tool (Scissors, Forceps, or Scalpel)?
            - If Fail: "Protocol Violation. Your hands must be completely empty before initializing a new state sequence. Place all instruments back on the surgical tray."
        
            STATE 2: ACTION REQUIRED
            - Check: Always fail this state.
            - Instruction: "Surgical field reset. Reach out and firmly grasp the Scalpel with your virtual hand mesh to initiate Phase 1."
            `;
        }
        else if (currentState.includes("Phase4") || currentState.includes("Phase5") || currentState.includes("Phase7")) {
            console.log(`MediCrisis Core: Engine reports Excision Phase [${currentState}]. Hard-locking AI to Scissor Protocol.`);
            dynamicStateMachine = `
            [SCALPEL PROTOCOL COMPLETE. SHIFTING TO EXCISION.]
            
            STATE 5: EXCISION TOOL ACQUISITION
            - CRITICAL RULE: DO NOT look for a scalpel. The current objective requires Scissors.
            - Check: Is the user holding the surgical Scissors?
            - If Fail: "Scalpel incision complete. Locate and equip the surgical scissors from the tray to proceed with the excision."
            
            STATE 6: APPENDIX TARGETING
            - Check: Are the scissors aligned near the appendix base?
            - If Active: Evaluate the precision and safety of the scissor placement before the final cut.
            `;
        }
        else {
            console.log(`MediCrisis Core: Engine reports Scalpel is HELD [${currentState}]. Hard-locking AI to Alignment & Execution.`);
            dynamicStateMachine = `
            [STATES 1 & 2 AUTOMATICALLY PASSED. SCALPEL ACQUISITION SECURE.]
            
            STATE 3: ALIGNMENT & PROXIMITY
            - CRITICAL RULE: DO NOT evaluate if the hand is holding the scalpel. The C# sensors confirm it IS held.
            - Check ONLY this: Is the Scalpel tip positioned too high up in the air or horizontally far away from the Incision Target crease?
            - If Fail: "Scalpel acquisition verified. Proceed with structural alignment: lower the blade tip until it is positioned directly above the central incision crease."
        
            STATE 4: EXECUTION
            - Check: Is the Scalpel tip actively making physical contact with the Incision Target crease?
            - If Active: Evaluate the precision, centering, and vertical orientation of the cut along the incision boundary.
            `;
        }

        const systemPrompt = `You are the MediCrisis Core, a zero-tolerance AI Surgical Director.
        Analyze the VR visual snapshot and the user's audio request simultaneously.

        [0. C# GROUND TRUTH (CRITICAL)]
        The Unity Physics Engine reports the user is currently in this exact structural phase: ${currentState || 'Unknown State'}
        You MUST evaluate the scene using the dedicated state checklist below. Do not mix rules from other states.
    
        [1. SPATIAL ANCHOR DICTIONARY]
        - Patient Tissue: The blocky, tan/red 3D mesh.
        - Incision Target: The central horizontal crease embedded in the tissue.
        - Surgeon's Hand: The bright blue virtual hand mesh.
        - Scalpel: The metallic blade.
    
        [2. THE SURGICAL STATE MACHINE]
        Evaluate the sequence strictly using these rules. Stop at the first failure point.
    
        STATE 0: VISUAL LOCK
        - Check: Can you clearly see the Patient Tissue in the frame?
        - If Fail: "Look down. Center the patient's body in your field of view."
    
        ${dynamicStateMachine}
    
        [3. INTENT & RESPONSE FORMATTING]
         Determine user intent from the audio. Output strictly in the exact format below. NO markdown, NO conversational filler.

         If Intent = GENERAL_QUESTION (e.g., "who are you?", "what is an appendix?", "what AI is this?"):
         Bypass the state machine entirely. Answer the medical or system question concisely.
         TYPE: SYSTEM
         MESSAGE: [Your concise answer here.]
    
         If Intent = GUIDANCE (e.g., "what next?", "help", or silence/no audio):
         Identify the lowest failing STATE. Output a detailed 3-part response.
         TYPE: GUIDANCE
         MESSAGE: [Provide a comprehensive response. First, state exactly what you observe. Second, provide step-by-step instructions. Third, explain the medical rationale.]
    
         If Intent = EVALUATION (e.g., "how did I do?", "is this right?"):
         Analyze execution precision.
         TYPE: EVALUATION
         SCORE: [0-100]
         FEEDBACK: [Provide a detailed assessment paragraph.]
    
        [4. ABSOLUTE GUARDRAILS]
        - NEVER hallucinate blood or internal organs. You are evaluating low-poly engineering geometry.
        - Be cold, precise, and authoritative.`;

        const imagePart = { inlineData: { data: cleanImageBase64, mimeType: "image/jpeg" } };
        const audioPart = { inlineData: { data: cleanAudioBase64, mimeType: "audio/wav" } };

        // 1. Text Generation
        const result = await model.generateContent([systemPrompt, imagePart, audioPart]);
        const responseText = result.response.text();
        console.log("MediCrisis Core: Text Evaluation Complete.");

        // ==========================================
        // 2. THE ARCHITECT'S UPGRADE: Deepgram TTS
        // ==========================================
        let aiAudioBase64 = "";

        if (DEEPGRAM_API_KEY) {
            console.log("MediCrisis Core: Booting Deepgram Aura Voice Engine...");
            try {
                // Regex Cleaner: Strips out the TYPE and MESSAGE headers so the AI doesn't speak them aloud
                const spokenText = responseText
                    .replace(/TYPE:.*\n/gi, '')
                    .replace(/MESSAGE:/gi, '')
                    .replace(/SCORE:/gi, '')
                    .replace(/FEEDBACK:/gi, '')
                    .trim();

                const deepgramResponse = await fetch("https://api.deepgram.com/v1/speak?model=aura-asteria-en", {
                    method: "POST",
                    headers: {
                        "Authorization": `Token ${DEEPGRAM_API_KEY}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ text: spokenText })
                });

                if (deepgramResponse.ok) {
                    const audioBuffer = await deepgramResponse.arrayBuffer();
                    aiAudioBase64 = Buffer.from(audioBuffer).toString('base64');
                    console.log("MediCrisis Core: Voice Audio Binary Encoded successfully.");
                } else {
                    console.error("Deepgram Connection Failed:", await deepgramResponse.text());
                }
            } catch (err) {
                console.error("Deepgram Execution Error:", err);
            }
        } else {
            console.warn("⚠️ WARNING: DEEPGRAM_API_KEY missing from .env! Sending silent text payload.");
        }

        // 3. Dispatch Dual Payload to Unity
        res.status(200).json({
            response: responseText,
            aiAudioBase64: aiAudioBase64
        });
        console.log("MediCrisis Core: Transaction Fully Complete. Awaiting next command.");

    } catch (error) {
        console.error("MediCrisis Core Error:", error);
        res.status(500).json({ error: "Failed to connect to AI Core." });
    }
});

// 5. Shutdown Endpoint
app.post('/api/shutdown', (req, res) => {
    res.json({ message: "Shutting down..." });
    console.log("Shutting down server via API...");
    setTimeout(() => process.exit(0), 500);
});

// WebSocket Connection
let clientCount = 0;
let shutdownTimer = null;

io.on('connection', (socket) => {
    clientCount++;
    console.log('Client connected:', socket.id);

    if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
    }

    socket.on('join_tenant', (hospitalId) => {
        socket.join(hospitalId);
        console.log(`Socket ${socket.id} joined tenant room: ${hospitalId}`);
    });

    socket.on('disconnect', () => {
        clientCount--;
        console.log('Client disconnected:', socket.id);

        if (clientCount === 0) {
            console.log("No active clients. Starting 3 second shutdown timer...");
            shutdownTimer = setTimeout(() => {
                console.log("Shutting down server due to no active clients...");
                process.exit(0);
            }, 3000);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Real-Time Infrastructure listening on port ${PORT}`);
});