import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { sanitizeProfile, sanitizeSaved, type SavedItem, type StoredProfile } from '../../shared/profile';
import type { UserLocation } from '../../shared/types';
import { ApiError } from './errors';
import { auth, db } from './firebase';

export { ApiError, ERROR_TEXT } from './errors';

/**
 * The account: Firebase Auth for e-mail and password, Firestore for what the account keeps
 * (`users/{uid}`: profile; `saved/{eventId}`; `meta/viewed`). firestore.rules let each
 * user read and write only their own documents.
 */

export interface Me {
  email: string;
  profile: StoredProfile | null;
  /** Ids of news this user already opened. */
  viewed: string[];
  saved: SavedItem[];
}

const MAX_SAVED = 500;
const MAX_VIEWED = 2000;

/** Firebase error codes → the codes the screens already know (ERROR_TEXT). Network errors stay as they are. */
function mapAuthError(e: unknown): unknown {
  const code = (e as { code?: string }).code ?? '';
  const known: Record<string, [number, string]> = {
    'auth/invalid-email': [400, 'invalid_email'],
    'auth/missing-email': [400, 'invalid_email'],
    'auth/weak-password': [400, 'weak_password'],
    'auth/email-already-in-use': [409, 'email_taken'],
    'auth/invalid-credential': [401, 'invalid_credentials'],
    'auth/wrong-password': [401, 'invalid_credentials'],
    'auth/user-not-found': [401, 'invalid_credentials'],
    'auth/missing-password': [401, 'invalid_credentials'],
    'auth/too-many-requests': [429, 'rate_limited'],
  };
  const hit = known[code];
  return hit ? new ApiError(hit[0], hit[1]) : e;
}

const userDoc = (uid: string) => doc(db(), 'users', uid);
const viewedDoc = (uid: string) => doc(db(), 'users', uid, 'meta', 'viewed');
const savedCol = (uid: string) => collection(db(), 'users', uid, 'saved');
/** Firestore rejects `undefined`; a JSON round trip drops it. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function currentUser(): User {
  const u = auth().currentUser;
  if (!u) throw new ApiError(401, 'unauthenticated');
  return u;
}

async function loadMe(u: User): Promise<Me> {
  const [profile, viewed, saved] = await Promise.all([getDoc(userDoc(u.uid)), getDoc(viewedDoc(u.uid)), getDocs(savedCol(u.uid))]);
  const rawProfile = profile.data()?.profile as string | undefined;
  const ids = viewed.data()?.ids;
  return {
    email: u.email ?? '',
    profile: rawProfile ? sanitizeProfile(JSON.parse(rawProfile)) : null,
    viewed: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
    saved: saved.docs
      .map((d) => sanitizeSaved(d.data()))
      .filter((x): x is SavedItem => !!x)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  };
}

/** Follows the session: called with the account on login (and on page load if still logged in), null on logout. */
export function watchSession(onChange: (me: Me | null) => void, onError: (e: unknown) => void): () => void {
  return onAuthStateChanged(auth(), (u) => {
    if (!u) return onChange(null);
    loadMe(u).then(onChange, onError);
  });
}

export async function register(email: string, password: string): Promise<Me> {
  try {
    const { user } = await createUserWithEmailAndPassword(auth(), email.trim(), password);
    return await loadMe(user);
  } catch (e) {
    throw mapAuthError(e);
  }
}

export async function login(email: string, password: string): Promise<Me> {
  try {
    const { user } = await signInWithEmailAndPassword(auth(), email.trim(), password);
    return await loadMe(user);
  } catch (e) {
    throw mapAuthError(e);
  }
}

/** Firebase e-mails a link to choose a new password. */
export async function resetPassword(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth(), email.trim());
  } catch (e) {
    throw mapAuthError(e);
  }
}

export async function logout(): Promise<void> {
  await signOut(auth()).catch(() => undefined);
}

export async function saveProfile(p: StoredProfile): Promise<StoredProfile> {
  const profile = sanitizeProfile(p);
  await setDoc(userDoc(currentUser().uid), { profile: JSON.stringify(profile), updatedAt: new Date().toISOString() });
  return profile;
}

/** Firebase asks for the current password again before sensitive changes. */
async function reauthenticate(password: string): Promise<User> {
  const u = currentUser();
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email ?? '', password));
  } catch (e) {
    throw mapAuthError(e);
  }
  return u;
}

export async function changePassword(current: string, next: string): Promise<void> {
  const u = await reauthenticate(current);
  try {
    await updatePassword(u, next);
  } catch (e) {
    throw mapAuthError(e);
  }
}

/** Erases everything the account kept, then the account itself. */
export async function deleteAccount(password: string): Promise<void> {
  const u = await reauthenticate(password);
  const saved = await getDocs(savedCol(u.uid));
  const batch = writeBatch(db());
  for (const d of saved.docs) batch.delete(d.ref);
  batch.delete(viewedDoc(u.uid));
  batch.delete(userDoc(u.uid));
  await batch.commit();
  try {
    await deleteUser(u);
  } catch (e) {
    throw mapAuthError(e);
  }
}

export async function markViewed(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const ref = viewedDoc(currentUser().uid);
  const before = (await getDoc(ref)).data()?.ids;
  const all = [...new Set([...(Array.isArray(before) ? before : []), ...ids])].slice(-MAX_VIEWED);
  await setDoc(ref, { ids: all });
}

export async function saveItem(item: SavedItem): Promise<void> {
  const uid = currentUser().uid;
  const clean = sanitizeSaved(item);
  if (!clean) throw new ApiError(400, 'invalid_item');
  const count = await getCountFromServer(savedCol(uid));
  if (count.data().count >= MAX_SAVED) throw new ApiError(409, 'too_many_saved');
  await setDoc(doc(savedCol(uid), clean.id), plain(clean));
}

export async function unsaveItem(id: string): Promise<void> {
  await deleteDoc(doc(savedCol(currentUser().uid), id));
}

/** Header for SAND's own API (city search): the Firebase ID token of the logged-in user. */
export async function authHeader(): Promise<Record<string, string>> {
  const u = auth().currentUser;
  return u ? { Authorization: `Bearer ${await u.getIdToken()}` } : {};
}

/** GPS → city. The browser rounds to ~11 km before sending; the server rounds again. */
export async function reverseGeocode(lat: number, lon: number): Promise<UserLocation | null> {
  const res = await fetch(`/api/geocode/reverse?lat=${lat.toFixed(1)}&lon=${lon.toFixed(1)}`, { headers: await authHeader() });
  const body = (await res.json().catch(() => ({}))) as { result?: UserLocation | null; error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `http_${res.status}`);
  return body.result ?? null;
}
