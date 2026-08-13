import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireProjectId } from "./_env.js";

// Initialize the global interest rate. Run once after first deploy.
//   GCLOUD_PROJECT=<id> npx tsx scripts/init-settings.ts        (defaults to 2%)
//   GCLOUD_PROJECT=<id> npx tsx scripts/init-settings.ts 0.03   (3% monthly)
const rate = process.argv[2] !== undefined ? Number(process.argv[2]) : 0.02;

if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
  console.error("Rate must be a number between 0 and 1 (e.g. 0.02 = 2% monthly).");
  process.exit(1);
}

initializeApp({ projectId: requireProjectId() });
const db = getFirestore();

await db.collection("settings").doc("interest").set({ defaultRate: rate });
console.log(`Set settings/interest defaultRate=${rate} (${(rate * 100).toFixed(2)}% monthly).`);
