import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/**
 * Firebase web app, configured by the VITE_FIREBASE_* variables (public by design: what
 * protects the data is Firebase Auth plus firestore.rules, not this config).
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = !!(config.apiKey && config.authDomain && config.projectId);

let app: FirebaseApp | undefined;
function firebaseApp(): FirebaseApp {
  if (!firebaseConfigured) throw new Error('Firebase não configurado (VITE_FIREBASE_* ausentes)');
  return (app ??= getApps()[0] ?? initializeApp(config));
}

export const auth = (): Auth => getAuth(firebaseApp());
export const db = (): Firestore => getFirestore(firebaseApp());
