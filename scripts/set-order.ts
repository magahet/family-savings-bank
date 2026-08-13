import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireProjectId } from "./_env.js";

// Sets the `order` field used to sort accounts on the dashboard.
// Pass account IDs in the desired order:
//   GCLOUD_PROJECT=<id> npx tsx scripts/set-order.ts alice bob cora
// With no arguments, orders all accounts alphabetically by name.

initializeApp({ projectId: requireProjectId() });
const db = getFirestore();

let ids = process.argv.slice(2);

if (ids.length === 0) {
  const snap = await db.collection("accounts").get();
  ids = snap.docs
    .sort((a, b) => String(a.data().name ?? a.id).localeCompare(String(b.data().name ?? b.id)))
    .map((d) => d.id);
}

for (let idx = 0; idx < ids.length; idx++) {
  await db.collection("accounts").doc(ids[idx]).update({ order: idx });
  console.log(`Set ${ids[idx]} order=${idx}`);
}
