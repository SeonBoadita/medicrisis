const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const SECRET_KEY = process.env.SECRET_KEY || 'vitalrush-super-secret-key';

async function runSimulation() {
    console.log("🚀 Starting VR Telemetry Simulation...");
    
    // Step 1: Authenticate the headset and get JWT
    console.log("🔑 Authenticating VR Headset...");
    let token;
    try {
        const authResponse = await axios.post('http://localhost:3000/api/auth', {
            deviceId: 'VR_Headset_001',
            hospitalId: 'public'
        });
        token = authResponse.data.token;
        console.log("✅ Authenticated successfully. JWT acquired.");
    } catch (e) {
        console.error("❌ Authentication failed:", e.message);
        return;
    }

    // List of simulated surgeons
    const surgeons = [
        "Dr. A. Shepherd", "Dr. C. Yang", "Dr. M. Grey", 
        "Dr. O. Hunt", "Dr. R. Webber", "Dr. A. Lincoln"
    ];

    // Helper to sleep
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Send random surgical telemetry every 5 seconds
    for (let i = 0; i < 5; i++) {
        await sleep(5000); // 5 seconds wait
        
        const payload = {
            player_name: surgeons[Math.floor(Math.random() * surgeons.length)],
            integrity_score: Math.floor(Math.random() * 40) + 60, // Score between 60-100
            duration_seconds: Math.floor(Math.random() * 300) + 60, // Duration between 60s - 360s
            surgery_status: Math.random() > 0.8 ? 'Stopped' : 'Completed' // 80% completion rate
        };

        const payloadString = JSON.stringify(payload);
        
        // Generate cryptographic hash signature
        const signature = crypto.createHmac('sha256', SECRET_KEY).update(payloadString).digest('hex');

        console.log(`\n📡 Transmitting Surgery Data for ${payload.player_name}...`);
        
        try {
            const response = await axios.post('http://localhost:3000/api/telemetry', payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-Signature': signature
                }
            });
            console.log("✅ Telemetry Accepted. Response:", response.data);
        } catch (e) {
            console.error("❌ Telemetry Rejected:", e.response ? e.response.data : e.message);
        }
    }
    
    console.log("\n🎉 Simulation complete! Check your leaderboard dashboard.");
}

runSimulation();
