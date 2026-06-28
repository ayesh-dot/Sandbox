import 'dotenv/config'; // Loads environment variables
import express from 'express';
import cors from 'cors';
import admin from 'firebase-admin';
import serviceAccount from './service-account.json' with { type: "json" };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();

app.use(cors());
app.use(express.json());

app.post('/initiateTransfer', async (req, res) => {
    // Your logic here
    res.status(200).send({ success: true, message: "Transfer successful" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));