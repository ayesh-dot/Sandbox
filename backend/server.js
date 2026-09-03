import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import crypto from 'crypto';

import { Client, GatewayIntentBits } from 'discord.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import OAuth2 from 'discord-oauth2';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}

const db = admin.firestore();
const app = express();

app.use(cors({
    origin: '*', // Or specify 'http://localhost:5500'
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

import rateLimit from 'express-rate-limit';

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 requests per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." }
});

app.use(globalLimiter);


// Middleware to verify ID Token
app.use(async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (idToken) {
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            req.user = decodedToken;
            next();
        } catch (e) {
            return res.status(401).send({ error: "unauthorized" });
        }
    } else {
        return  res.status(401).send({ error: "unauthorized" });
    }
});

app.post('/initiatetransfer', async (req, res) => {

    const uid = req.user?.uid;
    if (!uid) {
        return res.status(401).send({ error: "unauthorized", message: "Unauthorized." });
    }

    if (!uid) {
        console.warn('❌ Auth failed: No UID found on req.user or req.body');
        return res.status(401).send({ error: "unauthenticated", message: "You must be logged in to execute this transfer." });
    }

    try {
        const { recipientEmail, transferAmount, key } = req.body;

        const { uniqueUUID: UUID, cipherPad, issuedAt, signature } = key || {};

        const userDoc = await admin.firestore().collection("userdata").doc(uid).get();
        
        if (!userDoc.exists) {
            console.warn('❌ User document not found for UID:', uid);
            return res.status(404).send({ error: "not-found", message: "User account not found." });
        }
        const userData = userDoc.data();
        // console.log('👤 Sender User Data (balance, etc.):', userData);

        let recipientUserRecord;
        try {
            recipientUserRecord = await admin.auth().getUserByEmail(recipientEmail);
            // console.log('📫 Recipient Auth Record found - UID:', recipientUserRecord.uid);
        } catch (e) {
            console.warn('❌ getUserByEmail failed for recipientEmail:', recipientEmail, '| Error:', e.message);
            return res.status(404).send({ error: "not-found", message: "Recipient not found." });
        }

        const recipientUid = recipientUserRecord.uid;
        const recipientDoc = await admin.firestore().collection("userdata").doc(recipientUid).get();
        // console.log('📂 Recipient userdata doc exists?', recipientDoc.exists);

        if (!recipientDoc.exists) {
            console.warn('❌ Recipient userdata document not found for UID:', recipientUid);
            return res.status(404).send({ error: "not-found", message: "Recipient not found." });
        }

        if (userData.balance < transferAmount) {
            console.warn(`❌ Insufficient funds: User balance (${userData.balance}) < transferAmount (${transferAmount})`);
            return res.status(400).send({ error: "failed-precondition", message: "Insufficient funds for this transfer." });
        }

        if (recipientUid === uid) {
            console.warn('❌ Self-transfer attempted.');
            return res.status(400).send({ error: "failed-precondition", message: "You cannot transfer funds to yourself." });
        }

        if (transferAmount <= 0) {
            console.warn('❌ Invalid transfer amount (<= 0):', transferAmount);
            return res.status(400).send({ error: "failed-precondition", message: "Transfer amount must be greater than zero." });
        }

        if (!UUID || !signature || !cipherPad || cipherPad.length < 6) {
            console.warn('❌ Missing or short key parameters:', { UUID: !!UUID, signature: !!signature, cipherPadLength: cipherPad?.length });
            return res.status(400).send({ error: "invalid-argument", message: "Invalid key data provided." });
        }

        if (typeof transferAmount !== "number" || isNaN(transferAmount)) {
            console.warn('❌ transferAmount is not a valid number:', transferAmount, typeof transferAmount);
            return res.status(400).send({ error: "invalid-argument", message: "Transfer amount must be a valid number." });
        }

        if (typeof recipientEmail !== "string" || !recipientEmail.includes("@")) {
            console.warn('❌ Invalid recipient email format:', recipientEmail);
            return res.status(400).send({ error: "invalid-argument", message: "Invalid recipient email provided." });
        }

        if(cipherPad.some(digit => typeof digit !== "number" || digit < 0 || digit > 9)) {
            console.warn('❌ cipherPad contains invalid digits:', cipherPad);
            return res.status(400).send({ error: "invalid-argument", message: "Cipher pad must contain only digits between 0 and 9." });
        }

        if (UUID.length !== 36) {
            console.warn('❌ UUID length is not 36:', UUID?.length);
            return res.status(400).send({ error: "invalid-argument", message: "UUID must be a valid 36-character string." });
        }

        const doc = await admin.firestore().collection("private").doc(uid).get();
        if (!doc.exists || !doc.data().privateId) {
            console.warn('❌ Private ID not found for UID:', uid);
            return res.status(404).send({ error: "not-found", message: "Private ID not found for user." });
        }
        
        const privateId = doc.data().privateId;

        const payloadString = JSON.stringify({ uniqueUUID: UUID, cipherPad, issuedAt, privateId });
        const expectedSignature = crypto.createHmac('sha256', process.env.PRIVATE_VERIFICATION_KEY)
                                    .update(payloadString)
                                    .digest('hex');



        if (signature !== expectedSignature) {
            console.warn('❌ Signature mismatch detected!');
            return res.status(401).send({ error: "unauthenticated", message: "Invalid cryptographic signature. Key tampering or account mismatch detected." });
        }
        
        const existingSms = await admin.firestore().collection("sms").doc(uid).get();

        if (existingSms.exists) {
            const smsData = existingSms.data();
            const expiresAt = smsData.expiresAt?.toDate();
            const now = new Date();

            // Check if the 5-minute window is still active
            if (expiresAt && now < expiresAt) {
                console.warn('❌ Active verification request pending for UID:', uid);
                return res.status(429).send({ 
                    error: "too-many-requests", 
                    message: "Security cooldown active. Please wait for the 5-minute window to expire." 
                });
            } else {
                // If it's expired, clear the stale record before generating the new one
                await admin.firestore().collection("sms").doc(uid).delete();
            }
        }

        let code = [];
        let encryptedCode = [];

        for(let i = 0; i < 6; i++){
            code.push(Math.floor(Math.random() * 10));    
        };

        for(let i = 0; i < 6; i++){
            const padValue = cipherPad[i % cipherPad.length];
            encryptedCode.push((code[i] + padValue) % 10);
        };

        let finalEncrypted = crypto.createHash('sha256').update(encryptedCode.join('') + UUID).digest('hex');
        // console.log('🎲 Generated verification code successfully.');

        const expirationTime = new Date();
        expirationTime.setMinutes(expirationTime.getMinutes() + 5);

        await admin.firestore().collection("sms").doc(uid).set({
            code: finalEncrypted,
            senderUid: uid,
            recipientEmail: recipientEmail,
            transferAmount: transferAmount,
            expiresAt: admin.firestore.Timestamp.fromDate(expirationTime),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // console.log('💾 Firestore SMS document created successfully.');

        const idToken = req.headers.authorization?.split('Bearer ')[1];
        await sendCode(idToken, code.join(''));
        // console.log('📤 Verification code dispatched successfully.');

        return res.status(200).send({ success: true, message: "Transfer successful" });

    } catch (error) {
        console.error('🔥 UNCAUGHT ERROR in /initiatetransfer route:');
        console.error(error);
        return res.status(500).send({ error: "internal", message: error.message });
    }
});


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

app.post('/api/sign-key', async (req, res) => {
    const { uniqueUUID, cipherPad, issuedAt } = req.body;

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;

    const docRef = db.collection('private').doc(uid);
    const doc = await docRef.get();

    if (!doc.exists || !doc.data().privateId) {
        throw new Error('Private ID not found for user');
    }

    const privateId = doc.data().privateId;

    if (!uniqueUUID || !cipherPad || !issuedAt) {
        return res.status(400).json({ error: "Missing required fields." });
    }

    const payloadString = JSON.stringify({ uniqueUUID, cipherPad, issuedAt, privateId });
    const signature = crypto.createHmac('sha256', process.env.PRIVATE_VERIFICATION_KEY)
                            .update(payloadString)
                            .digest('hex');

    res.json({ signature });
});




const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages // Required to send DMs
    ] 
});

client.once('ready', () => {
    console.log(`Auth Bot logged in as ${client.user.tag}`);
});

async function sendCode(idToken, code) {
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
        const nameRegex = /^[a-zA-Z\s'-]+/;
        if (!nameRegex.test(firstName) || !nameRegex.test(lastName)) {
            return res.status(400).json({ error: "Names can only contain letters and standard characters." });
        }

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

        const privateId = crypto.randomBytes(16).toString('hex');
        await db.collection('private').doc(uid).set({ 
            privateId: privateId,
        });

        console.log(`✅ Server successfully created account with card ${uniqueCardNumber} for UID: ${uid}`);
        return res.status(200).json({ success: true, message: "Account created successfully." });

    } catch (error) {
        console.error("❌ Backend error during account creation:", error);
        return res.status(500).json({ error: "Internal server error while creating account." });
    }
});

client.login(process.env.AUTH_BOT_TOKEN);

app.post('/commitTransfer', async (req, res) => {

    const { code, key} = req.body;
    if (!key) {
        return res.status(400).json({ error: "invalid-argument", message: "Key object is required." });
    }


    if (!code) {
        return res.status(400).json({ error: "Verification code is required." });
    }

    if (!/^\d+$/.test(code)) {
        return res.status(400).json({ error: "Verification code must contain numbers only." });
    }

    if (code.length !== 6) {
        return res.status(400).json({ error: "Code must be exactly 6 digits." });
    }


    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    const uid = decodedToken.uid;
    if (!uid) {
        return res.status(401).send({ error: "unauthorized", message: "Unauthorized." });
    }

    const smsDoc = await admin.firestore().collection("sms").doc(uid).get();
    if (!smsDoc.exists) {
        console.warn('❌ No pending transfer found for UID:', uid);
        return res.status(404).send({ error: "not-found", message: "No pending transfer found." });
    }


    const { uniqueUUID, cipherPad, issuedAt, signature } = key;

    const verificationResult = await verifyKey(uniqueUUID, cipherPad, issuedAt, signature, uid);
    if (!verificationResult.valid) {
        return res.status(verificationResult.status).send({ error: verificationResult.error, message: verificationResult.message });
    }

    const smsData = smsDoc.data();
    const { code: storedCode, expiresAt, recipientEmail, transferAmount } = smsData;

    

});

async function verifyKey(UUID, cipherPad, issuedAt, signature, uid) {

    // 1. Structural checks
    if (!UUID || !signature || !cipherPad || cipherPad.length < 6) {
        console.warn('❌ Missing or short key parameters:', { UUID: !!UUID, signature: !!signature, cipherPadLength: cipherPad?.length });
        return { valid: false, status: 400, error: "invalid-argument", message: "Invalid key data provided." };
    }

    if (cipherPad.some(digit => typeof digit !== "number" || digit < 0 || digit > 9)) {
        console.warn('❌ cipherPad contains invalid digits:', cipherPad);
        return { valid: false, status: 400, error: "invalid-argument", message: "Cipher pad must contain only digits between 0 and 9." };
    }

    if (UUID.length !== 36) {
        console.warn('❌ UUID length is not 36:', UUID?.length);
        return { valid: false, status: 400, error: "invalid-argument", message: "UUID must be a valid 36-character string." };
    }

    // 2. Fetch private ID from Firestore
    const doc = await admin.firestore().collection("private").doc(uid).get();
    if (!doc.exists || !doc.data().privateId) {
        console.warn('❌ Private ID not found for UID:', uid);
        return { valid: false, status: 404, error: "not-found", message: "Private ID not found for user." };
    }
    
    const privateId = doc.data().privateId;

    // 3. Cryptographic HMAC verification
    const payloadString = JSON.stringify({ UUID, cipherPad, issuedAt, privateId });
    const expectedSignature = crypto.createHmac('sha256', process.env.PRIVATE_VERIFICATION_KEY)
                                .update(payloadString)
                                .digest('hex');

    if (signature !== expectedSignature) {
        console.warn('❌ Signature mismatch detected!');
        return { valid: false, status: 401, error: "unauthenticated", message: "Invalid cryptographic signature. Key tampering or account mismatch detected." };
    }

    return { valid: true };
}