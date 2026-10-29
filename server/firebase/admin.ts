import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin, from the service account JSON in FIREBASE_SERVICE_ACCOUNT (a GitHub
 * Actions secret for the ingestion job, a Vercel env var for the API functions).
 * Server-side only: it bypasses the security rules.
 */
function app(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT não configurada (JSON da conta de serviço do Firebase)');
  const sa = JSON.parse(raw) as { project_id: string; client_email: string; private_key: string };
  return initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }) });
}

export const adminDb = () => getFirestore(app());
export const adminAuth = () => getAuth(app());
