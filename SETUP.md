# GasBridge - Firebase Setup & Local Execution Guide

This guide walks you through connecting GasBridge to your live Firebase project or running it in instant demo presentation mode.

---

## ⚡ Instant Demo Mode (Zero Configuration Required)

GasBridge is designed so you can immediately run and demonstrate it in a college or project review environment without being blocked by API setup:

1. Open the project folder in **Visual Studio Code**.
2. Start a local server:
   - **VS Code Live Server Extension**: Right click `index.html` → **"Open with Live Server"**.
   - **Python**: Run `python -m http.server 3000` in the terminal and open `http://localhost:3000`.
   - **Node.js**: Run `npx serve .` and open the displayed port.
3. Create the administrator account in Firebase Authentication using `admin@gasbridge.com`, then use that account to sign in. The app does not ship a default admin password.
4. For a safe end-to-end demo, create separate Firebase accounts for the customer, distributor, and delivery agent roles, and use the approval workflow to activate them.

---

## 🛡️ Multi-Role Registration & Admin Approval Architecture

1. **System Administrator**:
   - Create the single administrator account in Firebase Authentication. The email must match `admin@gasbridge.com` unless custom claims and corresponding rules are configured.
   - The administrator can review and accept/decline new applicants across all roles.

2. **Customer Registration & Admin Approval**:
   - Customers register with their full name, mobile, email, password, and home address at `pages/register.html?role=customer`.
   - Accounts are placed into `pending` state and prevented from logging in.
   - The Admin accepts them in **Customer Management** (`pages/admin-customers.html`).
   - Once accepted, the customer can log in, book domestic/commercial cylinders, and track deliveries.

3. **Distributor Registration & Admin Approval**:
   - Agencies register with their agency details, official contacts, physical depot address, and covered pincodes at `pages/register.html?role=distributor`.
   - Accounts are placed into `pending` state and prevented from logging in.
   - The Admin accepts them in **Manage Distributors** (`pages/admin-distributors.html`).
   - Once accepted, their depot and service areas are activated, cylinder inventory is allocated, and the distributor can log in.

4. **Delivery Agent Registration & Admin Approval**:
   - Delivery personnel register with vehicle specifications and operating pincode at `pages/register.html?role=agent`.
   - Accounts are placed into `pending` state and prevented from logging in.
   - The Admin accepts them in **Manage Delivery Agents** (`pages/admin-agents.html`) (or their assigned depot distributor in `distributor-agents.html`).
   - Once accepted, the agent is activated with duty status `available` and can log into the mobile delivery portal.

---

## 🚀 Connecting to Live Firebase

To connect GasBridge to your own live Cloud Firestore and Firebase Authentication backend:

### Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **"Add project"** and name it `GasBridge-LPG` (or your preferred name).
3. Disable or enable Google Analytics (optional) and click **Create Project**.

### Step 2: Register a Web App
1. In your Firebase Project Overview page, click the **Web icon `</>`** to register a web app.
2. Enter App nickname (e.g., `GasBridge Web App`).
3. Click **Register app**.

### Step 3: Copy Firebase Configuration Keys
1. Copy the `firebaseConfig` object displayed on the screen. It looks like:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "gasbridge-lpg.firebaseapp.com",
     projectId: "gasbridge-lpg",
     storageBucket: "gasbridge-lpg.appspot.com",
     messagingSenderId: "123456789...",
     appId: "1:123456789:web:..."
   };
   ```
2. Open [`js/firebase-config.js`](js/firebase-config.js) in your project.
3. Replace the placeholder values with your real configuration values:
   ```javascript
   export const firebaseConfig = {
     apiKey: "YOUR_ACTUAL_API_KEY",
     authDomain: "YOUR_PROJECT.firebaseapp.com",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT.appspot.com",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```

### Step 4: Enable Authentication
1. In Firebase Console, go to **Build > Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab, click **Email/Password**.
4. Enable **Email/Password** and click **Save**.

### Step 5: Create Cloud Firestore Database
1. In Firebase Console, go to **Build > Firestore Database**.
2. Click **Create database**.
3. Choose a location close to your users (e.g., `asia-south1` for Mumbai/India).
4. Start in **Production mode** (or Test mode).
5. Click **Create**.

### Step 6: Deploy Firestore Security Rules
1. In Firebase Console under Firestore Database, click the **Rules** tab.
2. Open the file [`firestore.rules`](firestore.rules) from this project.
3. Copy the entire contents and paste them into the Firestore Rules editor.
4. Click **Publish**.

### Step 7: Provision the first service area and inventory
Live mode does not write sample master data from an unauthenticated browser. Create the first `serviceAreas` and matching approved `distributors` documents in Firestore Console. A `serviceAreas` document needs an `active` flag, a `pincodes` array, and a `distributorId`. When the administrator approves a distributor, GasBridge creates its initial inventory. Customer signup and live checkout depend on the service area and distributor records.

### Step 8: (Optional) Firebase Storage
If you wish to host uploaded delivery agent photos or depot receipts:
1. Go to **Build > Storage**.
2. Click **Get Started** and apply [`storage.rules`](storage.rules).

---

## 🌐 Running Locally in Modern Browsers

Because GasBridge uses official ES Modules (`import/export`) for the Firebase Modular SDK:
- **Always run the application through an HTTP server** (e.g., `http://localhost:5500/` or `http://localhost:3000/`).
- Do not open the HTML files using the `file://` protocol directly, as modern browsers restrict ES Module loading from local disk paths.

---

## 🧪 Quick Test Checklist
- **Customer Registration**: Register with pincode `509216` → confirms Shadnagar Service Area.
- **Unsupported Pincode**: Test with `110001` → shows service unavailable notice.
- **Booking Flow**: Book 1 Domestic LPG cylinder → check inventory → Demo Payment → get `GB-YYYYMMDD-XXXX` ID.
- **Distributor Depot**: View bookings filtered to Shadnagar → assign delivery agent.
- **Delivery Agent**: View assigned delivery → click "Navigate" (Google Maps) → mark as Out for Delivery → Delivered.
- **Customer Live Tracking**: Stepper advances through all 6 milestones.
