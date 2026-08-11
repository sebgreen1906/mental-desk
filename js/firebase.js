import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, fetchSignInMethodsForEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, query, where, orderBy, limit, startAt, endAt, getDocs, runTransaction }
  from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDtYad9YdJ8hueIS3ecetmQrQjlJv6lVQI",
  authDomain: "mental-desk.firebaseapp.com",
  projectId: "mental-desk",
  storageBucket: "mental-desk.firebasestorage.app",
  messagingSenderId: "394120628833",
  appId: "1:394120628833:web:adbbd2dbcba7d9d41c3820"
};
const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, fetchSignInMethodsForEmail,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, query, where, orderBy, limit, startAt, endAt, getDocs, runTransaction
};
