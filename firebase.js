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
export const OWNER_WHATSAPP = "254700000000";
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
    console.error('[Triza Wanjiru] Firebase init failed:', e);
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
  businessName: "Triza Wanjiru", legalName: "", registrationNo: "", kraPin: "",
  phone: "0700 000 000", whatsapp: "254700000000", email: "",
  address: "Nairobi, Kenya (Nationwide Delivery)",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Horizon+Plaza+Kenya+Kenya",
  hoursText: "We reply to WhatsApp requests Mon - Sat, 9:00 AM - 6:00 PM.",
  tillNumber: "", paybill: "", accountName: "",
  intasendPublicKey: DEFAULT_INTASEND_PUBLIC_KEY, intasendLive: false,
  enableOnlinePayment: true, enableManualMpesa: true,
  enablePayOnPickup: true, enableBooking: true,
  bookingHoldHours: 24, bookingDepositPercent: 50, payNowHoldMinutes: 15,
  deliveryZones: [
    { name: "Nairobi Pickup", fee: 0, eta: "When goods arrive" },
    { name: "Countrywide Courier", fee: 350, eta: "1-2 days after arrival" }
  ],
  announcement: "China to Kenya  |  Pickup at Nairobi CBD, Kenya  |  Pay with M-Pesa",
  returnsText: "", termsText: "", privacyText: "", deliveryText: ""
};
