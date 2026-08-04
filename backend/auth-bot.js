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

client.login(process.env.AUTH_BOT_TOKEN);