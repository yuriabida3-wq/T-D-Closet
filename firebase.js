/* ============================================================
   firebase.js — Firebase init + shared exports
   ============================================================ */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC_DyUKofWKyei4HEsN2t9bVyFPe0lxgh0",
  authDomain: "td-closet-bungoma.firebaseapp.com",
  projectId: "td-closet-bungoma",
  storageBucket: "td-closet-bungoma.firebasestorage.app",
  messagingSenderId: "549471432223",
  appId: "1:549471432223:web:428f2c7d5d7138ffb3ef2a"
};

export const SITE_URL = "https://YOUR-SITE.onrender.com";
export const OWNER_WHATSAPP = "254740552916";
export const DEFAULT_INTASEND_PUBLIC_KEY = "";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter,
  onSnapshot, runTransaction, writeBatch,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export function isConfigReady() {
  return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.indexOf('PASTE_') !== 0;
}

let app = null, db = null, auth = null;
if (isConfigReady()) {
  try {
    app = initializeApp(FIREBASE_CONFIG);
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    } catch (e) {
      db = getFirestore(app);
    }
    auth = getAuth(app);
  } catch (e) {
    console.error('[T&D] Firebase init failed:', e);
    app = db = auth = null;
  }
}
export { app, db, auth };

export const fs = {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter,
  onSnapshot, runTransaction, writeBatch,
  serverTimestamp, Timestamp
};
export const authFns = {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail
};

export const DEFAULT_SETTINGS = {
  businessName: "T&D Closet", legalName: "", registrationNo: "", kraPin: "",
  phone: "0740 552 916", whatsapp: OWNER_WHATSAPP, email: "",
  address: "Horizon Plaza, 4th Floor, Shop 1011 (opposite the bus station), Bungoma, Kenya",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Horizon+Plaza+Bungoma+Kenya",
  hoursText: "Mon - Sat, 8:00 AM - 8:00 PM. Sunday: closed.",
  tillNumber: "", paybill: "", accountName: "",
  intasendPublicKey: DEFAULT_INTASEND_PUBLIC_KEY, intasendLive: false,
  enableOnlinePayment: true, enableManualMpesa: true,
  enablePayOnPickup: true, enableBooking: true,
  bookingHoldHours: 24, bookingDepositPercent: 0, payNowHoldMinutes: 15,
  deliveryZones: [
    { name: "Bungoma Town", fee: 150, eta: "Same day" },
    { name: "Nationwide (courier)", fee: 350, eta: "1 - 3 days" }
  ],
  announcement: "Nationwide delivery  |  Pickup at Horizon Plaza, Bungoma  |  Pay with M-Pesa",
  returnsText: "", termsText: "", privacyText: "", deliveryText: ""
};
