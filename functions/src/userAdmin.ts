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
 * Public: does this instance still need its first admin? Returns only a boolean,
 * so it is safe to call before anyone is signed in — the first-run UI uses it to
 * decide whether to show the "set up your bank" panel.
 */
export const needsSetup = onCall(async () => {
  const claimed = (await getFirestore().collection("settings").doc("system").get()).data()?.ownerClaimed === true;
  return { needsSetup: !claimed && !(await anAdminExists()) };
});

/**
 * First-run only: promote the CALLER to admin, but only while no admin exists.
 * Self-locking — once the first admin is set, this permanently refuses, so it can
 * never be used to escalate privileges afterward. A Firestore transaction on
 * settings/system makes concurrent first calls race-safe.
 */
export const bootstrapFirstAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in (or create your login) first.");
  }
  const db = getFirestore();
  const systemRef = db.collection("settings").doc("system");

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(systemRef);
    if (snap.data()?.ownerClaimed === true) {
      throw new HttpsError("failed-precondition", "This bank has already been set up.");
    }
    // Backstop against a wiped flag: if an admin somehow already exists, lock and refuse.
    if (await anAdminExists()) {
      tx.set(systemRef, { ownerClaimed: true }, { merge: true });
      throw new HttpsError("failed-precondition", "This bank has already been set up.");
    }
    tx.set(systemRef, {
      ownerClaimed: true,
      ownerUid: request.auth!.uid,
      claimedAt: FieldValue.serverTimestamp(),
    });
  });

  await getAuth().setCustomUserClaims(request.auth.uid, { role: "admin" });
  return { success: true };
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
