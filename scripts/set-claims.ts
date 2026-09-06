import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { requireProjectId } from "./_env.js";

// Grant a role to an existing Firebase Auth user. To create the user and set the
// role in one step instead, use scripts/create-user.ts. Project ID comes from
// .firebaserc (override with GCLOUD_PROJECT=<id>).
//   npx tsx scripts/set-claims.ts parent@example.com admin
//   npx tsx scripts/set-claims.ts kid@example.com child
const email = process.argv[2];
const role = process.argv[3];

if (!email || (role !== "admin" && role !== "child")) {
  console.error(
    "Usage: npx tsx scripts/set-claims.ts <email> <admin|child>"
  );
  process.exit(1);
}

initializeApp({ projectId: requireProjectId() });

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { role });
console.log(`Set role="${role}" for ${email} (uid: ${user.uid}).`);
console.log("The user must sign out and back in for the new role to take effect.");
