import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

type Role = "admin" | "child";

function assertRole(value: unknown): asserts value is Role {
  if (value !== "admin" && value !== "child") {
    throw new HttpsError("invalid-argument", 'role must be "admin" or "child".');
  }
}

function requireAdmin(request: CallableRequest) {
  if (request.auth?.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

// Scan Auth for any user that already holds the admin role. Paginates so it stays
// correct beyond the first 1000 users (a family instance never gets close).
async function anAdminExists(): Promise<boolean> {
  const auth = getAuth();
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    if (page.users.some((u) => (u.customClaims as { role?: string } | undefined)?.role === "admin")) {
      return true;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return false;
}

/**
 * Public: is this instance ready for, and still in need of, first-run setup?
 * Safe to call before anyone is signed in — the first-run UI uses it to decide
 * what to show. Returns only booleans, never the allowlisted owner email.
 *   needsSetup    — no admin has claimed this bank yet.
 *   ownerEmailSet — the operator has authorized an owner email (setup is "open").
 */
export const needsSetup = onCall(async () => {
  const data = (await getFirestore().collection("settings").doc("system").get()).data();
  const claimed = data?.ownerClaimed === true;
  const ownerEmailSet = typeof data?.ownerEmail === "string" && data.ownerEmail.trim() !== "";
  return { needsSetup: !claimed && !(await anAdminExists()), ownerEmailSet };
});

/**
 * First-run only: provision the first admin. There is no open registration — the
 * caller must present the email the operator pre-authorized in settings/system
 * (written server-side via `scripts/set-owner.ts`, never by a client). Only that
 * email can claim admin, and only while no admin exists yet.
 *
 * The owner account is created server-side (public self-signup is disabled), so
 * this callable is intentionally public: it is safe because it grants admin ONLY
 * to the allowlisted email and self-locks after the first claim. A Firestore
 * transaction on settings/system reserves the claim race-safely; if provisioning
 * the Auth user then fails, the reservation is rolled back so setup can retry.
 */
export const bootstrapFirstAdmin = onCall(async (request) => {
  const { email, password } = request.data as { email?: string; password?: string };
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "email is required.");
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new HttpsError("invalid-argument", "password must be at least 6 characters.");
  }
  const normEmail = email.trim().toLowerCase();

  const db = getFirestore();
  const auth = getAuth();
  const systemRef = db.collection("settings").doc("system");

  // Reserve the claim atomically, gating on the allowlisted owner email.
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(systemRef)).data();
    if (data?.ownerClaimed === true) {
      throw new HttpsError("failed-precondition", "This bank has already been set up.");
    }
    const ownerEmail = typeof data?.ownerEmail === "string" ? data.ownerEmail.trim().toLowerCase() : "";
    if (!ownerEmail) {
      throw new HttpsError("failed-precondition", "Setup isn't open yet — the operator must authorize an owner email first.");
    }
    if (normEmail !== ownerEmail) {
      throw new HttpsError("permission-denied", "That email isn't authorized to set up this bank.");
    }
    // Backstop against a wiped flag: if an admin somehow already exists, lock and refuse.
    if (await anAdminExists()) {
      tx.set(systemRef, { ownerClaimed: true }, { merge: true });
      throw new HttpsError("failed-precondition", "This bank has already been set up.");
    }
    tx.set(systemRef, { ownerClaimed: true, claimedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  // Claim reserved — provision (or adopt) the owner's admin login.
  try {
    let uid: string;
    try {
      uid = (await auth.createUser({ email: normEmail, password })).uid;
    } catch (err) {
      // A login with the allowlisted email may already exist (e.g. created in the
      // console). Adopt it — admin is granted to that account, not to this caller.
      if ((err as { code?: string }).code === "auth/email-already-exists") {
        uid = (await auth.getUserByEmail(normEmail)).uid;
      } else {
        throw err;
      }
    }
    await auth.setCustomUserClaims(uid, { role: "admin" });
    await systemRef.set({ ownerUid: uid }, { merge: true });
    return { success: true };
  } catch (err) {
    // Provisioning failed — release the reservation so setup can be retried.
    await systemRef.set({ ownerClaimed: false, claimedAt: FieldValue.delete() }, { merge: true });
    throw err;
  }
});

/** Admin-only: create a login and assign its role in one call. */
export const createUser = onCall(async (request) => {
  requireAdmin(request);
  const { email, password, role } = request.data as { email?: string; password?: string; role?: string };
  if (!email || typeof email !== "string") {
    throw new HttpsError("invalid-argument", "email is required.");
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    throw new HttpsError("invalid-argument", "password must be at least 6 characters.");
  }
  assertRole(role);

  const auth = getAuth();
  let uid: string;
  try {
    uid = (await auth.createUser({ email, password })).uid;
  } catch (err) {
    if ((err as { code?: string }).code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "A user with that email already exists.");
    }
    throw err;
  }
  await auth.setCustomUserClaims(uid, { role });
  return { uid };
});

/** Admin-only: list all users with their roles, for the management UI. */
export const listUsers = onCall(async (request) => {
  requireAdmin(request);
  const auth = getAuth();
  const users: { uid: string; email: string | undefined; role: string | null; disabled: boolean }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      users.push({
        uid: u.uid,
        email: u.email,
        role: ((u.customClaims as { role?: string } | undefined)?.role) ?? null,
        disabled: u.disabled,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return { users };
});

/** Admin-only: change a user's role. Guards against removing the last admin. */
export const setUserRole = onCall(async (request) => {
  requireAdmin(request);
  const { uid, role } = request.data as { uid?: string; role?: string };
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  assertRole(role);

  const auth = getAuth();
  const target = await auth.getUser(uid);
  const wasAdmin = (target.customClaims as { role?: string } | undefined)?.role === "admin";
  if (wasAdmin && role !== "admin" && !(await hasAnotherAdmin(uid))) {
    throw new HttpsError("failed-precondition", "Can't demote the last admin.");
  }
  await auth.setCustomUserClaims(uid, { role });
  return { success: true };
});

/** Admin-only: delete a user. Guards against deleting the last admin and self-deletion. */
export const deleteUser = onCall(async (request) => {
  requireAdmin(request);
  const { uid } = request.data as { uid?: string };
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "uid is required.");
  }
  if (uid === request.auth!.uid) {
    throw new HttpsError("failed-precondition", "You can't delete your own account.");
  }
  const target = await getAuth().getUser(uid);
  const isAdmin = (target.customClaims as { role?: string } | undefined)?.role === "admin";
  if (isAdmin && !(await hasAnotherAdmin(uid))) {
    throw new HttpsError("failed-precondition", "Can't delete the last admin.");
  }
  await getAuth().deleteUser(uid);
  return { success: true };
});

// Is there an admin OTHER than `excludeUid`?
async function hasAnotherAdmin(excludeUid: string): Promise<boolean> {
  const auth = getAuth();
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    if (page.users.some((u) => u.uid !== excludeUid && (u.customClaims as { role?: string } | undefined)?.role === "admin")) {
      return true;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return false;
}
