import { vi } from 'vitest';
import type { Me } from '../../src/services/account';
import { ApiError, ERROR_TEXT } from '../../src/services/errors';

/**
 * Stand-ins for the Firebase-backed modules in UI tests (wired with vi.mock in each file).
 * `fakeAccount` replaces src/services/account; `fakeFirestore` replaces firebase/firestore,
 * so the app's realtime feed subscription can be observed without a network.
 */

export const fakeAccount = {
  /** Account the session starts with (null = logged out). */
  me: null as Me | null,
  /** Error code `login` should fail with, if any. */
  loginError: undefined as string | undefined,
  savedProfile: undefined as unknown,
  reverseCalls: [] as [number, number][],
  reverseResult: null as unknown,
  reset() {
    this.me = null;
    this.loginError = undefined;
    this.savedProfile = undefined;
    this.reverseCalls = [];
    this.reverseResult = null;
  },
};

const newMe = (email: string): Me => ({ email, profile: null, viewed: [], saved: [] });

export const accountModule = {
  ApiError,
  ERROR_TEXT,
  watchSession: (onChange: (me: Me | null) => void) => {
    queueMicrotask(() => onChange(fakeAccount.me));
    return () => {};
  },
  login: vi.fn(async (email: string) => {
    if (fakeAccount.loginError) throw new ApiError(401, fakeAccount.loginError);
    return newMe(email);
  }),
  register: vi.fn(async (email: string) => newMe(email)),
  resetPassword: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  saveProfile: vi.fn(async (p: unknown) => {
    fakeAccount.savedProfile = p;
    return p;
  }),
  changePassword: vi.fn(async () => {}),
  deleteAccount: vi.fn(async () => {}),
  markViewed: vi.fn(async () => {}),
  saveItem: vi.fn(async () => {}),
  unsaveItem: vi.fn(async () => {}),
  authHeader: async () => ({ Authorization: 'Bearer test-token' }),
  reverseGeocode: vi.fn(async (lat: number, lon: number) => {
    fakeAccount.reverseCalls.push([lat, lon]);
    return fakeAccount.reverseResult;
  }),
};

export const fakeFirestore = { subscriptions: 0 };

export const firestoreModule = {
  collection: () => ({}),
  doc: () => ({}),
  increment: (n: number) => n,
  setDoc: vi.fn(async () => {}),
  onSnapshot: () => {
    fakeFirestore.subscriptions++;
    return () => {};
  },
};

export const firebaseModule = { firebaseConfigured: true, db: () => ({}), auth: () => ({}) };
