// ==========================================================================
// FIREBASE MODULE IMPORTS
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
    getAuth, 
    signInWithPopup, 
    GoogleAuthProvider, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc,
    query,
    where,
    getDocs,
    collection
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

// ==========================================================================
// CONFIGURATION & INITIALIZATION
// ==========================================================================
const firebaseConfig = {
    apiKey: "AIzaSyAQwvcLuC_Q4EFwVOEql1bs_-ZBUfIIrTU",
    authDomain: "sandbox-api-0.firebaseapp.com",
    projectId: "sandbox-api-0",
    storageBucket: "sandbox-api-0.firebasestorage.app",
    messagingSenderId: "694378819078",
    appId: "1:694378819078:web:eb2a676bb311bae48b5d87",
    measurementId: "G-PBCBYYSTLP"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ==========================================================================
// DOM ELEMENT REFERENCES
// ==========================================================================
const loggedOutView = document.getElementById('logged-out-view');
const loggedInView = document.getElementById('logged-in-view');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userPhoto = document.getElementById('user-photo');
const userName = document.getElementById('user-name');
const userEmail = document.getElementById('user-email');
const balanceDisplay = document.querySelector('.balance-display');
const main = document.getElementById('main-card');

// ==========================================================================
// AUTHENTICATION LISTENERS & CONTROLLERS
// ==========================================================================

// Handle Login Click
loginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, provider);
        
    } catch (error) {
        console.error("Authentication Error:", error.message);
        // modernAlert("Failed to sign in: " + error.message);
    }
});

// Handle Logout Click
logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        hideDashboards();
    } catch (error) {
        console.error("Signout Error:", error);
    }
});

// Centralized Auth State Observer
onAuthStateChanged(auth, async (user) => {
    if (user) {

        let status = await getLoggedIndata();

        if (status === created) {

            userName.textContent = `Welcome back, ${user.displayName}`;
            userEmail.textContent = user.email;
            userPhoto.src = user.photoURL || 'https://via.placeholder.com/72';

            let accountData = await getLoggedIndata(true);
            console.log("Verified User Account Payload:", accountData);
            
            showDashboards();
            updateUI(accountData);
            

            loggedOutView.classList.add('hidden');
            loggedInView.classList.remove('hidden');
            main.classList.remove('hidden');           // Ensure main dashboard shows
            createAccountCard.classList.add('hidden');  // Ensure registration card stays hidden
        } else {
            // User is authenticated via Google but has no profile document in Firestore
            main.classList.add('hidden');
            createAccountCard.classList.remove('hidden');
            loggedOutView.classList.add('hidden');      // Hide login splash during registration
        }
        
    } else {
        // Reset UI layout and view toggles immediately on logout
        loggedOutView.classList.remove('hidden');
        loggedInView.classList.add('hidden');
        main.classList.remove('hidden');
        createAccountCard.classList.add('hidden');
        balanceDisplay.textContent = "$0.00";
    }
});

const uncreated = "UNCREATED_ACCOUNT";
const created = "CREATED_ACCOUNT";
const createAccountCard = document.getElementById('create-account-card');

async function getLoggedIndata(dataMessage) {
    const user = auth.currentUser;
    

    if (user) {
        // 🟢 The name of the document IS user.uid, so we look for that exact file path
        const docRef = doc(db, "userdata", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const accountData = docSnap.data();
            console.log("Found your file! Here is the data:", accountData);
            
            // Now you can display the balance, card number, etc. on your UI
            console.log("Card Number:", accountData.cardNumber);
            console.log("Balance:", accountData.balance);
            if(dataMessage){
                return accountData;
            } else{return created;};
            

        } else {

            console.log("No account file exists with this UID name!");
            return uncreated;
        
        }
    } else {
        console.log("No user is logged in right now.");
    }
}



// ==========================================================================
// CREATE BUTTON DOM ELEMENTS
// ==========================================================================

// Name Inputs
const firstNameInput  = document.getElementById('first-name-input');
const lastNameInput   = document.getElementById('last-name-input');

// Date of Birth Inputs
const dayInput        = document.getElementById('day-input');
const monthInput      = document.getElementById('month-input');
const yearInput       = document.getElementById('year-input');

// Additional Information Inputs
const cvvInput        = document.getElementById('cvv-box');
const phoneInput      = document.getElementById('phone-number');

// Action Button
const createAccButton = document.getElementById('create-account-button');

// ========================================================================== 
// ==========================================================================

// Keep the generator function clean outside your main listener
function generateRandomDebitCard() {
    let cardNum = "478392"; // Custom sandbox prefix (BIN)
    for (let i = 0; i < 10; i++) {
        cardNum += Math.floor(Math.random() * 10).toString();
    }
    return cardNum;
}


createAccButton.addEventListener('click', async () => {

    if (!phoneInput.value.trim() || !firstNameInput.value.trim() || !lastNameInput.value.trim()) {
        modernAlert("Please complete Name and Phone fields before continuing.");
        return;
    }

    let uniqueCardNumber = "";
    let isUnique = false;

    const user = auth.currentUser;

    if (!user) {
        console.log("No User Detected!");
        return;
    }


    while (!isUnique) {
        uniqueCardNumber = generateRandomDebitCard();

        console.log(`Checking database uniqueness for card: ${uniqueCardNumber}...`);

        // Create a query checking if any doc has this card number
        const cardQuery = query(
            collection(db, "userdata"), 
            where("cardNumber", "==", uniqueCardNumber)
        );
        
        // Execute the query check
        const querySnapshot = await getDocs(cardQuery);

        if (querySnapshot.empty) {
            isUnique = true;
            console.log("Card number is unique! Proceeding with account creation.");
            
        } else {
            console.warn("Collision detected! Regenerating card number...");
        }
    }


    const accountData = {
        firstName: firstNameInput.value.trim(),
        lastName: lastNameInput.value.trim(),
        dob: `${yearInput.value}-${monthInput.value}-${dayInput.value}`,
        cvv: cvvInput.value,
        phone: phoneInput.value.trim(),
        cardNumber: uniqueCardNumber, // This is guaranteed unique now
        balance: 100.00,             // Starting seed capital
        uid: user.uid
    };


    try {
        const documentId = accountData.uid; 
        const userDocRef = doc(db, "userdata", documentId);
        
        console.log("Document reference created. Sending payload...");
        
        // Pause and wait for the database write operation to complete successfully
        await setDoc(userDocRef, accountData);
        
        console.log("🎯 Server acknowledged the write!");
        generateKeyJSON();
        modernAlert('Your information has been saved successfully!');
        
        // Pause and wait for the profile checker function to return the string status
        let status = await getLoggedIndata();
        let xAccountData = await getLoggedIndata(true);

        if (status === created) {
            // Update user profile info in the UI
            userName.textContent = `Welcome back, ${user.displayName}`;
            userEmail.textContent = user.email;
            userPhoto.src = user.photoURL || 'https://via.placeholder.com/72';
            showDashboards();
            updateUI(xAccountData);
            
            // Toggle view visibility
            main.classList.remove('hidden');
            loggedOutView.classList.add('hidden');
            loggedInView.classList.remove('hidden');
            createAccountCard.classList.add('hidden'); // Ensure registration card hides
        } else {
            main.classList.add('hidden');
            createAccountCard.classList.remove('hidden');
        }

    } catch (error) {
        // This catch block catches server rejections from setDoc, getLoggedIndata, or local code errors
        console.error("❌ SERVER REJECTED THE WRITE OR LOCAL FAILURE:", error);
        modernAlert("Account Creation Error: " + error.message);
    }
});

document.body.addEventListener('keydown', function(event) {
    // Check if the pressed key is Enter
    if (event.key === 'Enter') {
        
        // Target only text-based inputs and dropdowns (exclude textareas and submit buttons)
        const activeElement = document.activeElement;
        const validTypes = ['text', 'email', 'number', 'tel', 'url', 'password', 'date', 'select-one'];
        
        if (activeElement && (validTypes.includes(activeElement.type) || activeElement.tagName === 'SELECT')) {
            
            event.preventDefault(); // Stop the form from submitting
            
            // Get all focusable elements on the page in order
            const focusableElements = Array.from(document.querySelectorAll('input, select, textarea, button'))
                .filter(el => !el.disabled && el.tabIndex !== -1);
            
            // Find where the user is currently typing
            const currentIndex = focusableElements.indexOf(activeElement);
            
            // Find the next element in line
            const nextElement = focusableElements[currentIndex + 1];
            
            if (nextElement) {
                nextElement.focus(); // Jump to the next box
            }
        }
    }
});

function updateUI(accountData){
    // --- DOM ELEMENTS ---
    const cardNumberDisplay = document.querySelector('.card-number-display');
    const cardCvvDisplay    = document.getElementById('ui-card-cvv');
    const cardNameDisplay   = document.getElementById('ui-card-name');
    const cardRevealBtn     = document.getElementById('revealer');
    // --- --- --- --- ---
    balanceDisplay.textContent = `$${accountData.balance.toFixed(2)}`;
    cardNameDisplay.textContent = `${accountData.firstName} ${accountData.lastName}`.toUpperCase();

};

const revealButton = document.getElementById('revealer');

revealButton.addEventListener('click', revealData)


async function revealData(){

//#region Card Display DOM ELEMENTS
    const cardNumberDisplay = document.querySelector('.card-number-display');
    const cardCvvDisplay    = document.getElementById('ui-card-cvv');
    const cardNameDisplay   = document.getElementById('ui-card-name');
    const cardRevealBtn     = document.getElementById('revealer');
//#endregion

    const accountData = await getLoggedIndata(true);
    if (!accountData) return;

    // Force data to pristine string formats with no spacing artifacts
    const rawCardNumber = String(accountData.cardNumber).replace(/\s+/g, ''); 
    const rawCvv = String(accountData.cvv);

    // ==========================================================================
    // EXPLICIT CARD SEGMENT CONSTANTS
    // ==========================================================================
    const firstSixDigits = rawCardNumber.slice(0, 6);   // e.g., "478392"
    const lastFourDigits = rawCardNumber.slice(12, 16); // e.g., "5143"

    // Construct the fully raw number layout with clean 4-digit spacing blocks
    const p1 = rawCardNumber.slice(0, 4);
    const p2 = rawCardNumber.slice(4, 8);
    const p3 = rawCardNumber.slice(8, 12);
    const p4 = rawCardNumber.slice(12, 16);
    const rawNumberString = `${p1} ${p2} ${p3} ${p4}`;

    // Always ensure the uppercase profile name is set
    cardNameDisplay.textContent = `${accountData.firstName} ${accountData.lastName}`.toUpperCase();

    // Evaluate the toggle position based on state tracker
    const isCurrentlyHidden = cardRevealBtn.dataset.isHidden !== "false";

    if (isCurrentlyHidden) {
        // SHOW MODE: Output the clean, fully raw unmasked string
        cardNumberDisplay.textContent = rawNumberString;
        cardCvvDisplay.textContent = rawCvv;
        
        cardRevealBtn.textContent = "HIDE METADATA";
        cardRevealBtn.dataset.isHidden = "false";
    } else {
        // HIDDEN MODE: Manually format using both the first 6 and last 4 constants
        const block1 = firstSixDigits.slice(0, 4); // First 4 digits
        const block2 = firstSixDigits.slice(4, 6); // Next 2 digits
        
        // Assembles into: "XXXX XX•• •••• XXXX" matching your exact wrapping layout
        cardNumberDisplay.textContent = `${block1} ${block2}•• •••• ${lastFourDigits}`;
        cardCvvDisplay.textContent = "•••";
        
        cardRevealBtn.textContent = "REVEAL METADATA";
        cardRevealBtn.dataset.isHidden = "true";
    }
}


// --- DASHBOARD CONTAINER DOM CONSTANTS ---
const transfersDashboard = document.getElementById('transfers-dashboard');
const debitCardDashboard = document.getElementById('debit-card-dashboard');
const ledgerDashboard = document.getElementById('ledger-dashboard');
const cardConfigDashboard = document.getElementById('card-config-dashboard');
const keyUploadButton = document.getElementById('security-btn');
// --- --- --- --- --- --- --- --- --- --- -
// --- --- --- --- --- --- --- --- --- --- -

function hideDashboards(){
    transfersDashboard.classList.add('hidden');
    debitCardDashboard.classList.add('hidden');
    ledgerDashboard.classList.add('hidden');
    cardConfigDashboard.classList.add('hidden');
    keyUploadButton.classList.add('hidden');
}

async function showDashboards(){
    transfersDashboard.classList.remove('hidden');
    debitCardDashboard.classList.remove('hidden');
    ledgerDashboard.classList.remove('hidden');
    cardConfigDashboard.classList.remove('hidden');
    keyUploadButton.classList.remove('hidden');

    let xData = await getLoggedIndata(true);
    updateUI(xData);
}


function generateKeyJSON() {
    const uniqueId = window.crypto.randomUUID();
    let cipherPad = [];
    
    // Extract numerical values from the unique ID string
    let numbersOnly = uniqueId.replace(/[^0-9]/g, '');

    for (let i = 0; i < 6; i++) {
        // Fallback to a random integer if the UUID doesn't contain enough digits
        const digit = numbersOnly[i] ? parseInt(numbersOnly[i]) : Math.floor(Math.random() * 10);
        cipherPad.push(digit);
    }

    const keyFilePayload = {
        uniqueUUID: uniqueId,
        cipherPad: cipherPad,
        issuedAt: new Date().toISOString()
    };

    // Commit cleanly to local browser storage
    localStorage.setItem("sandbox_security_profile", JSON.stringify(keyFilePayload));
    console.log("🚀 Initial verification file successfully cached to localStorage.");

    // Trigger physical JSON backup profile download
    const jsonString = JSON.stringify(keyFilePayload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const fileUrl = URL.createObjectURL(blob);

    const downloadLink = document.createElement("a");
    downloadLink.href = fileUrl;
    // FIXED: Corrected reference variable to 'uniqueId' to prevent runtime crashes
    downloadLink.download = `sandbox_account_${uniqueId.substring(0, 8)}.json`; 
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(fileUrl);

    return keyFilePayload;
}

let loadedKeyData = null;

function checkLocalStorageSecurityStatus() {
    const cachedProfile = localStorage.getItem("sandbox_security_profile");
    // Preserved your original variable names
    const statusBtn = document.getElementById('security-btn');
    const statusEmoji = document.getElementById('status-emoji');

    if (!cachedProfile) {
        console.warn("⚠️ No security profile detected. Action required.");
        loadedKeyData = null; // Ensure memory is clean
        statusBtn.style.borderColor = '#ef4444';
        if (statusEmoji) statusEmoji.textContent = '❌';
        return;
    }

    try {
        const parsed = JSON.parse(cachedProfile);
        
        // Data Integrity: Ensuring the key is valid before loading
        if (!parsed.uniqueUUID || !parsed.cipherPad) {
            throw new Error("Invalid structure");
        }

        loadedKeyData = parsed; // Sync memory
        const displayId = parsed.uniqueUUID.substring(0, 8);
        console.log(`✅ System secure. User ID: ${displayId}...`);
        
        // UI Sync
        if (statusEmoji) statusEmoji.textContent = '✅';
        if (statusBtn) statusBtn.style.borderColor = '#10b981';
    } catch (e) {
        console.error("Critical: Cache corruption. Wiping profile.");
        clearSecurityKey(); // Using your original clear function
    }
}

const toggleKeyLink = document.getElementById("toggle-key-link");
const keyUploadSection = document.getElementById("key-upload-section");


// Run this when the DOM is fully parsed
document.addEventListener('DOMContentLoaded', () => {
    checkLocalStorageSecurityStatus();
});







function closeSecurityDialog() {
    const scrambledInput = document.getElementById("scrambled-input");
    const keyFileUpload = document.getElementById("key-file-upload");
    const securityDialog = document.getElementById("crypto-auth-modal");

    if (scrambledInput) scrambledInput.value = "";
    if (keyFileUpload) keyFileUpload.value = "";
    if (securityDialog) securityDialog.close();
}

function openSecurityDialog(){
    const scrambledInput = document.getElementById("scrambled-input");
    const keyFileUpload = document.getElementById("key-file-upload");
    const securityDialog = document.getElementById("crypto-auth-modal");

    securityDialog.showModal();
};





const transferBtn = document.getElementById('send-transfer-btn');

transferBtn.addEventListener('click', (event) => {


    if(!UI.transferAmount.value || !UI.transferRecipient.value) return;

    checkLocalStorageSecurityStatus();
    
    if(!loadedKeyData) {
        modernAlert("Action Required: Please upload your security key to proceed.");
        return; 
    }
    
    openSecurityDialog();
});



//Started UI Object From Now On
const UI = {
    cancelVerification: document.getElementById('close-modal-btn'),
    transferRecipient: document.getElementById('transfer-recipient'),
    transferAmount: document.getElementById('transfer-amount'),
};


UI.cancelVerification.addEventListener('click', () => {
    closeSecurityDialog();
    cancelVerification();
});








async function handleTransferRequest(amount, recipientId) {

    checkLocalStorageSecurityStatus();
    if(!loadedKeyData) return;

    

    try {

        const user = auth.currentUser;
        const idToken = await user.getIdToken();

        const response = await fetch('https://your-render-app-url.onrender.com/initiateTransfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                key: loadedKeyData,
                recipientEmail: recipientId,
                transferAmount: amount
            })
        });

        const result = await response.json();
        console.log(result);

        const userEnteredCode = prompt("Enter your 6-digit PIN:");

        if (userEnteredCode) {
            const result = await commitTransfer({
                userEnteredCode: userEnteredCode,
                transferAmount: amount,
                recipientUid: recipientId
            });

            if (result.data.verified) {
                modernAlert("Transfer Successful!");
            } else {
                modernAlert("Error: " + result.data.error);
            }
        }
    } catch (error) {
        modernAlert("Transaction failed: " + error.message);
    }
}


const btn = document.getElementById('security-btn');
const fileInput = document.getElementById('json-input');
const emoji = document.getElementById('status-emoji');


btn.addEventListener('click', () => {
    // If already checked, clear everything instantly
    if (emoji.textContent === '✅') {
        clearSecurityKey();
    } else {
        // Otherwise, open the modal
        document.getElementById('upload-modal').showModal();
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const data = JSON.parse(event.target.result);
            // Save to storage
            localStorage.setItem("sandbox_security_profile", JSON.stringify(data));
            
            // Re-run the status check to update the UI
            checkLocalStorageSecurityStatus();
            
            document.getElementById('upload-modal').close();
        };
        reader.readAsText(file);
    }
});


function clearSecurityKey() {
    const statusBtn = document.getElementById('security-btn');
    const statusEmoji = document.getElementById('status-emoji');
    const fileInput = document.getElementById('json-input');

    // Wipe
    localStorage.removeItem("sandbox_security_profile");
    loadedKeyData = null;
    
    // UI Reset
    if (fileInput) fileInput.value = "";
    statusEmoji.textContent = '❌';
    if (statusBtn) statusBtn.style.borderColor = '#cbd5e1';
    
    console.log("Security key cleared silently.");
    checkLocalStorageSecurityStatus();
}

function modernAlert(text) {
    const toast = document.getElementById('modern-alert');
    if (!toast) return;

    toast.textContent = text;
    
    toast.style.display = 'block';
    setTimeout(() => toast.style.opacity = '1', 10);
    

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.style.display = 'none', 300);
    }, 3000);
}

window.addEventListener('keydown', async(event) => {
    if (event.key === 'q') {
        const user = auth.currentUser;
        const idToken = await user.getIdToken();

        const response = await fetch('https://your-render-app-url.onrender.com/initiateTransfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                key: loadedKeyData,
                recipientEmail: "ayeshgithub@gmail.com",
                transferAmount: 67
            })
        });

        const result = await response.json();
        console.log(result);
    }
});