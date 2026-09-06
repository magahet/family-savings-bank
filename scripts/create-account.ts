import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { requireProjectId } from "./_env.js";

// Create a child account with zeroed balances.
//   npx tsx scripts/create-account.ts alice "Alice"
// Project ID comes from .firebaserc (override with GCLOUD_PROJECT=<id>).
// The id is used in the URL and must be lowercase, no spaces (e.g. "alice").
const id = process.argv[2];
const name = process.argv[3];

if (!id || !name || !/^[a-z0-9-]+$/.test(id)) {
  console.error(
    'Usage: npx tsx scripts/create-account.ts <id> "<Name>"\n' +
      "  <id> must be lowercase letters, numbers, or hyphens (e.g. alice)."
  );
  process.exit(1);
}

initializeApp({ projectId: requireProjectId() });
const db = getFirestore();

const ref = db.collection("accounts").doc(id);
if ((await ref.get()).exists) {
  console.error(`Account "${id}" already exists.`);
  process.exit(1);
}

// Append to the end of the dashboard order.
const order = (await db.collection("accounts").get()).size;

await ref.set({
  name,
  order,
  rateOverride: null,
  currentBalance: 0,
  totalInterest: 0,
  totalDeposits: 0,
  totalWithdrawals: 0,
  totalFines: 0,
  lastComputedAt: Timestamp.now(),
});

console.log(`Created account "${id}" (${name}) at dashboard position ${order}.`);
