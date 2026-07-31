import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

// Firebaseコンソール（プロジェクト設定 > 全般 > マイアプリ）で発行される値を
// .env ファイルに設定してください（README参照）。この設定値自体は公開しても
// 問題ない値ですが、実際のデータはFirestoreのセキュリティルールで保護します。
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export function signIn() {
  return signInWithPopup(auth, googleProvider);
}

export function logOut() {
  return signOut(auth);
}

const DOC_PATH = (uid) => doc(db, "users", uid, "app", "yukyu-techo");

export async function loadRemoteData(uid) {
  const snap = await getDoc(DOC_PATH(uid));
  if (snap.exists()) return snap.data();
  return null;
}

export async function saveRemoteData(uid, data) {
  await setDoc(DOC_PATH(uid), data, { merge: false });
}
