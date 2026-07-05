import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import crypto from 'crypto';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

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

        return res.status(200).send({ success: true, message: "Transfer successful" });

    } catch (error) {
        return res.status(500).send({ error: "internal", message: error.message });
    }
};

app.post('/initiateTransfer', initiateTransfer);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));