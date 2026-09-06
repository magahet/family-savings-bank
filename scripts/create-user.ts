import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { requireProjectId } from "./_env.js";

// Create (or reuse) a Firebase Auth user and grant it a role, in one step.
// Replaces the two-step "add user in the console, then set-claims" dance.
//   npx tsx scripts/create-user.ts parent@example.com "a-password" admin
//   npx tsx scripts/create-user.ts kid@example.com "a-password" child
// If the user already exists, its password is left unchanged and only the role
// is (re)applied — so this is safe to re-run.
const email = process.argv[2];
const password = process.argv[3];
const role = process.argv[4];

if (!email || !password || (role !== "admin" && role !== "child")) {
  console.error(
    'Usage: npx tsx scripts/create-user.ts <email> "<password>" <admin|child>\n' +
      "  password must be at least 6 characters (Firebase requirement)."
  );
  process.exit(1);
}
if (password.length < 6) {
  console.error("Password must be at least 6 characters (Firebase requirement).");
  process.exit(1);
}

initializeApp({ projectId: requireProjectId() });
const auth = getAuth();

let uid: string;
let created = false;
try {
  const user = await auth.createUser({ email, password });
  uid = user.uid;
  created = true;
} catch (err: unknown) {
  if ((err as { code?: string }).code === "auth/email-already-exists") {
    const existing = await auth.getUserByEmail(email);
    uid = existing.uid;
  } else {
    throw err;
  }
}

await auth.setCustomUserClaims(uid, { role });
console.log(
  `${created ? "Created" : "Found existing"} user ${email} (uid: ${uid}) with role="${role}".`
);
if (!created) console.log("(Existing user — password left unchanged.)");
console.log("They can sign in immediately; an existing user must sign out and back in for a role change to take effect.");
