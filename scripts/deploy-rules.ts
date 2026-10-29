/**
 * Publishes firestore.rules to the project of FIREBASE_SERVICE_ACCOUNT (`npm run deploy:rules`).
 * Uses the Admin SDK, so no `firebase login` is needed.
 */
import '../server/env';
import { readFileSync } from 'node:fs';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { adminDb } from '../server/firebase/admin';

adminDb(); // initializes the app from FIREBASE_SERVICE_ACCOUNT
const ruleset = await getSecurityRules().releaseFirestoreRulesetFromSource(readFileSync('firestore.rules', 'utf8'));
console.log(`regras do Firestore publicadas (${ruleset.name}, ${ruleset.createTime})`);
