import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { requireProjectId } from "./_env.js";

// Authorize the one email address allowed to claim the first admin, then open the
// in-browser setup screen. This is the allowlist that replaces open admin
// registration: the owner email is written server-side (only someone with deploy
// credentials can run this), and bootstrapFirstAdmin refuses any other email.
//
//   npx tsx scripts/set-owner.ts owner@example.com
//
// Safe to re-run *before* setup is claimed (updates the allowed email). Once an
// owner has claimed the bank (ownerClaimed=true) this refuses, so it can't be
// used to hand the bank to a different email after the fact — reset the instance
// first if you truly need to start over.
const email = process.argv[2];

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Usage: npx tsx scripts/set-owner.ts <owner-email>');
  process.exit(1);
}
const normEmail = email.trim().toLowerCase();

const project = requireProjectId();
initializeApp({ projectId: project });
const db = getFirestore();
const systemRef = db.collection("settings").doc("system");

const data = (await systemRef.get()).data();
if (data?.ownerClaimed === true) {
  console.error(
    `Refusing: ${project} has already been set up (ownerClaimed). ` +
      "Reset the instance if you need to reassign the owner."
  );
  process.exit(1);
}

await systemRef.set({ ownerEmail: normEmail }, { merge: true });
console.log(`Authorized owner email for ${project}: ${normEmail}`);
console.log("Now open the site — the setup screen will let that email create the admin login.");
