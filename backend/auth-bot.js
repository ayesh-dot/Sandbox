import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

import cors from 'cors';
import express from 'express';
import OAuth2 from 'discord-oauth2';

const app = express();

app.use(cors({
    origin: '*', // Or specify 'http://localhost:5500'
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

const oauth = new OAuth2({
    clientId: process.env.AUTH_BOT_CLIENT_ID,
    clientSecret: process.env.AUTH_BOT_CLIENT_SECRET,
    redirectUri: `https://sandbox-oypn.onrender.com/callback`,
});

app.get('/login', (req, res) => {
    const idToken = req.query.token;
    if (!idToken) {
        return res.status(401).send('Unauthorized: No token provided');
    }

    const url = oauth.generateAuthUrl({
        scope: ['identify'],
        state: idToken, // <-- This packages the token into Discord so it returns it on callback!
    });
    res.redirect(url);
});



app.get('/callback', async (req, res) => {
    const idToken = req.query.state;
    
    if (!idToken) {
        return res.status(401).send('Unauthorized: No token provided');
    }

    try {

        const decodedToken = await getAuth().verifyIdToken(idToken);
        const firestoreUid = decodedToken.uid;

        const { code } = req.query;
        const tokenData = await oauth.tokenRequest({
            code,
            scope: 'identify',
            grantType: 'authorization_code',
        });

        const discordUser = await oauth.getUser(tokenData.access_token);

        await db.collection('discord').doc(firestoreUid).set({
            discordId: discordUser.id
        }, { merge: true });

        res.send('Account linked successfully!');
        
    } catch (error) {
        console.error('Auth/Link Error:', error);
        res.status(500).send('Authentication failed');
    }
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));










initializeApp({
    credential: cert(serviceAccount)
});

const db = getFirestore();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages // Required to send DMs
    ] 
});

client.once('ready', () => {
    console.log(`Auth Bot logged in as ${client.user.tag}`);
});

export async function sendCode(idToken, code) {
    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        const firestoreUid = decodedToken.uid;

        const userDoc = await db.collection('discord').doc(firestoreUid).get();
        if (!userDoc.exists) {
            throw new Error('DOCUMENT_NOT_FOUND');
        }

        const discordId = userDoc.data().discordId;
        const discordUser = await client.users.fetch(discordId);
        
        await discordUser.send(`Your verification code is: ${code}`);
        return true;
    } catch (error) {
        console.error('SECURE_SEND_FAILURE:', error.message);
        return false;
    }
}

// Helper function to generate your sandbox debit card
function generateRandomDebitCard() {
    let cardNum = "478392"; // Custom sandbox prefix (BIN)
    for (let i = 0; i < 10; i++) {
        cardNum += Math.floor(Math.random() * 10).toString();
    }
    return cardNum;
}

app.post('/create-account', async (req, res) => {
    try {
        const { firstName, lastName, dob, cvv, phone, balance, uid } = req.body;

        // Validation check
        if (!uid || typeof uid !== 'string') {
            return res.status(400).json({ error: "Invalid or missing user ID." });
        }
        if (!firstName || !lastName || firstName.trim() === "" || lastName.trim() === "") {
            return res.status(400).json({ error: "First and last name are required." });
        }
        if (!phone || typeof phone !== 'string' || phone.trim() === "") {
            return res.status(400).json({ error: "A valid phone number is required." });
        }
        if (!/^\d{3,4}$/.test(cvv)) {
            return res.status(400).json({ error: "Invalid CVV format." });
        }

        // GENERATE UNIQUE CARD NUMBER ON THE SERVER
        let uniqueCardNumber = "";
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
            attempts++;
            uniqueCardNumber = generateRandomDebitCard();

            // Admin SDK query checks uniqueness safely without rule errors
            const existingCardQuery = await db.collection('userdata')
                .where('cardNumber', '==', uniqueCardNumber)
                .get();

            if (existingCardQuery.empty) {
                isUnique = true;
            }
        }

        if (!isUnique) {
            return res.status(500).json({ error: "Could not generate a unique card number. Please try again." });
        }

        // SECURE WRITE VIA ADMIN SDK
        const userDocRef = db.collection('userdata').doc(uid);
        
        const verifiedAccountData = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            dob: dob,
            cvv: cvv,
            phone: phone.trim(),
            cardNumber: uniqueCardNumber,
            balance: typeof balance === 'number' ? balance : 100.00,
            uid: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await userDocRef.set(verifiedAccountData);

        console.log(`✅ Server successfully created account with card ${uniqueCardNumber} for UID: ${uid}`);
        return res.status(200).json({ success: true, message: "Account created successfully." });

    } catch (error) {
        console.error("❌ Backend error during account creation:", error);
        return res.status(500).json({ error: "Internal server error while creating account." });
    }
});

client.login(process.env.AUTH_BOT_TOKEN);