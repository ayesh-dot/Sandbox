import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { sendCode } from './auth-bot.js';

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


app.post('/create-account', async (req, res) => {
    console.log("🔥 HIT /create-account ROUTE!");
    try {
        // your code here
        res.json({ success: true });
    } catch (err) {
        console.error("Route error:", err);
        res.status(500).json({ error: err.message });
    }
});

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
        next();
    }
});

export const initiateTransfer = async (req, res) => {
    const uid = req.user?.uid || req.body.uid; 
    if (!uid) {
        return res.status(401).send({ error: "unauthenticated", message: "You must be logged in to execute this transfer." });
    }

    try {
        const { recipientEmail, transferAmount, key } = req.body;
        const { uniqueUUID: UUID, cipherPad } = key || {};

        const userDoc = await admin.firestore().collection("userdata").doc(uid).get();
        if (!userDoc.exists) {
            return res.status(404).send({ error: "not-found", message: "User account not found." });
        }
        const userData = userDoc.data();

        let recipientUserRecord;
        try {
            recipientUserRecord = await admin.auth().getUserByEmail(recipientEmail);
        } catch (e) {
            return res.status(404).send({ error: "not-found", message: "Recipient not found." });
        }

        const recipientUid = recipientUserRecord.uid;
        const recipientDoc = await admin.firestore().collection("userdata").doc(recipientUid).get();

        if (!recipientDoc.exists) {
            return res.status(404).send({ error: "not-found", message: "Recipient not found." });
        }

        if (userData.balance < transferAmount) {
            return res.status(400).send({ error: "failed-precondition", message: "Insufficient funds for this transfer." });
        }

        if (recipientUid === uid) {
            return res.status(400).send({ error: "failed-precondition", message: "You cannot transfer funds to yourself." });
        }

        if (transferAmount <= 0) {
            return res.status(400).send({ error: "failed-precondition", message: "Transfer amount must be greater than zero." });
        }

        if (!UUID || !cipherPad || cipherPad.length < 6) {
            return res.status(400).send({ error: "invalid-argument", message: "Invalid key data provided." });
        }

        if (typeof transferAmount !== "number" || isNaN(transferAmount)) {
            return res.status(400).send({ error: "invalid-argument", message: "Transfer amount must be a valid number." });
        }

        if (typeof recipientEmail !== "string" || !recipientEmail.includes("@")) {
            return res.status(400).send({ error: "invalid-argument", message: "Invalid recipient email provided." });
        }

        if(cipherPad.some(digit => typeof digit !== "number" || digit < 0 || digit > 9)) {
            return res.status(400).send({ error: "invalid-argument", message: "Cipher pad must contain only digits between 0 and 9." });
        }

        if (UUID.length !== 36) {
            return res.status(400).send({ error: "invalid-argument", message: "UUID must be a valid 36-character string." });
        }

        const existingSms = await admin.firestore().collection("sms").doc(uid).get();
        if (existingSms.exists) {
            return res.status(400).send({ error: "already-exists", message: "A verification request is already pending." });
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

        const idToken = req.headers.authorization?.split('Bearer ')[1];
        await sendCode(idToken, code.join(''));

        return res.status(200).send({ success: true, message: "Transfer successful" });

    } catch (error) {
        return res.status(500).send({ error: "internal", message: error.message });
    }
};

app.post('/initiateTransfer', initiateTransfer);

// Helper function to generate your sandbox debit card
function generateRandomDebitCard() {
    let cardNum = "478392"; // Custom sandbox prefix (BIN)
    for (let i = 0; i < 10; i++) {
        cardNum += Math.floor(Math.random() * 10).toString();
    }
    return cardNum;
}

// app.post('/create-account', async (req, res) => {
//     try {
//         const { firstName, lastName, dob, cvv, phone, balance, uid } = req.body;

//         // Validation checks
//         if (!uid || typeof uid !== 'string') {
//             return res.status(400).json({ error: "Invalid or missing user ID." });
//         }
//         if (!firstName || !lastName || firstName.trim() === "" || lastName.trim() === "") {
//             return res.status(400).json({ error: "First and last name are required." });
//         }
//         if (!phone || typeof phone !== 'string' || phone.trim() === "") {
//             return res.status(400).json({ error: "A valid phone number is required." });
//         }
//         if (!/^\d{3,4}$/.test(cvv)) {
//             return res.status(400).json({ error: "Invalid CVV format." });
//         }

//         // GENERATE UNIQUE CARD NUMBER ON THE SERVER
//         let uniqueCardNumber = "";
//         let isUnique = false;
//         let attempts = 0;

//         while (!isUnique && attempts < 10) {
//             attempts++;
//             uniqueCardNumber = generateRandomDebitCard();

//             // Admin SDK query checks uniqueness safely without rule errors
//             const existingCardQuery = await db.collection('userdata')
//                 .where('cardNumber', '==', uniqueCardNumber)
//                 .get();

//             if (existingCardQuery.empty) {
//                 isUnique = true;
//             }
//         }

//         if (!isUnique) {
//             return res.status(500).json({ error: "Could not generate a unique card number. Please try again." });
//         }

//         // SECURE WRITE VIA ADMIN SDK
//         const userDocRef = db.collection('userdata').doc(uid);
        
//         const verifiedAccountData = {
//             firstName: firstName.trim(),
//             lastName: lastName.trim(),
//             dob: dob,
//             cvv: cvv,
//             phone: phone.trim(),
//             cardNumber: uniqueCardNumber,
//             balance: typeof balance === 'number' ? balance : 100.00,
//             uid: uid,
//             createdAt: admin.firestore.FieldValue.serverTimestamp()
//         };

//         await userDocRef.set(verifiedAccountData);

//         console.log(`✅ Server successfully created account with card ${uniqueCardNumber} for UID: ${uid}`);
//         return res.status(200).json({ success: true, message: "Account created successfully." });

//     } catch (error) {
//         console.error("❌ Backend error during account creation:", error);
//         return res.status(500).json({ error: "Internal server error while creating account." });
//     }
// });


const useRequestLogger = (req, res, next) => {
    console.log(`📥 INCOMING REQUEST: ${req.method} ${req.url}`);
    next();
};
app.use(useRequestLogger);

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));