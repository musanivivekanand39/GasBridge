/**
 * GasBridge - Firebase Modular SDK Bridge
 * Connects to live Firebase when keys are supplied,
 * or gracefully runs with local storage reactive store in Demo Mode.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs,
  runTransaction,
  setDoc, 
  writeBatch,
  updateDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig, isDemoConfig } from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;
let isDemo = isDemoConfig();

if (!isDemo) {
  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    console.log("GasBridge: Firebase initialized successfully with live project credentials.");
  } catch (err) {
    console.error("GasBridge: Firebase initialization failed. Authentication and cloud data are unavailable:", err);
    isDemo = true;
  }
} else {
  console.warn("GasBridge: Firebase is not configured. Authentication and cloud persistence are unavailable.");
}

export { 
  app, 
  auth, 
  db, 
  isDemo,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs, 
  runTransaction,
  setDoc, 
  writeBatch,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot
};
