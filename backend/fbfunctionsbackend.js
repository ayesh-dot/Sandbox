const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

exports.initiateTransfer = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "You must be logged in to execute this transfer.");
    }

    const userData = await admin.firestore().collection("userdata").doc(uid).get();
    const uid = request.auth.uid;
    const recepientEmail = request.data.recepientEmail;
    const transferAmount = request.data.transferAmount;
    const recepientUid = await admin.auth().getUserByEmail(recepientEmail);
    const recepient = await admin.firestore().collection("userdata").where("email", "==", recepientEmail).get();

    const key = request.data.key;

    const UUID = key.uniqueUUID;
    const cipherPad = key.cipherPad;

    // THIS IS WHERE THE VERIFICATION HAPPENS

    if (!recepient.exists) {
        throw new HttpsError("not-found", "Recipient not found.");
    }

    if (userData.data().balance < transferAmount) {
        throw new HttpsError("failed-precondition", "Insufficient funds for this transfer.");
    }

    if (recepientUid.uid === uid) {
        throw new HttpsError("failed-precondition", "You cannot transfer funds to yourself.");
    }
    
    if (transferAmount <= 0) {
        throw new HttpsError("failed-precondition", "Transfer amount must be greater than zero.");
    }

    if (!UUID || !cipherPad || cipherPad.length < 6) {
        throw new HttpsError("invalid-argument", "Invalid key data provided.");
    }

    if (typeof transferAmount !== "number" || isNaN(transferAmount)) {
        throw new HttpsError("invalid-argument", "Transfer amount must be a valid number.");
    }

    if (typeof recepientEmail !== "string" || !recepientEmail.includes("@")) {
        throw new HttpsError("invalid-argument", "Invalid recipient email provided.");
    }

    if(cipherPad.some(digit => typeof digit !== "number" || digit < 0 || digit > 9)) {
        throw new HttpsError("invalid-argument", "Cipher pad must contain only digits between 0 and 9.");
    }

    if (UUID.length !== 36) {
        throw new HttpsError("invalid-argument", "UUID must be a valid 36-character string.");
    }

    //END OF VERIFICATION REGION


    try {
        
        let code = [];
        let encryptedCode = [];

        for(let i = 0; i < 6; i++){
            const digit = Math.floor(Math.random() * 10);    
            code.push(digit);
        };

        
        for(let i = 0; i < 6; i++){

            const padValue = cipherPad[i % cipherPad.length];
            encryptedCode.push((code[i] + padValue) % 10);
        };

        encryptedCode = encryptedCode.join('') + UUID;
        encryptedCode = crypto.createHash('sha256').update(encryptedCode).digest('hex');
        


        //PRINT CODES
        await admin.firestore()
            .collection("sms")
            .doc(uid)
            .set({
                code: encryptedCode,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
    } catch (error) {
        throw new HttpsError("internal", error.message);
    }

});

exports.commitTransfer = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Auth required.");

    const uid = request.auth.uid;

    const lockDoc = await admin.firestore().collection("sms").doc(uid).get();
    if (!lockDoc.exists) throw new HttpsError("not-found", "No active transfer session found.");
    
    const { expectedCode } = lockDoc.data();

    if (parseInt(userEnteredCode) === expectedCode) {
        const db = admin.firestore();
        
        try {

            userData.balance -= transferAmount;

            
        } catch (txError) {
            throw new HttpsError("failed-precondition", txError.message);
        }

    } else {
        // Return failure if no match is found
        return { verified: false, error: "Security signature verification mismatch." };
    }

});

