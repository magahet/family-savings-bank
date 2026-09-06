import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Admin-only: permanently delete an account and everything under it (its
 * transactions and monthly snapshots), recursively. This is irreversible.
 *
 * As a guard against accidental loss, an account can only be deleted once it has
 * been **archived** (`archived: true`). The UI archives first and only offers
 * permanent deletion from the archived list, after a type-the-name confirmation
 * and an offer to download the account's data — see docs/data-safety.md.
 */
export const deleteAccount = onCall(async (request) => {
  if (request.auth?.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const { id } = request.data as { id?: string };
  if (!id || typeof id !== "string") {
    throw new HttpsError("invalid-argument", "id is required.");
  }

  const db = getFirestore();
  const ref = db.collection("accounts").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "That account no longer exists.");
  }
  if (snap.data()?.archived !== true) {
    throw new HttpsError("failed-precondition", "Archive the account before deleting it permanently.");
  }

  await db.recursiveDelete(ref);
  return { success: true };
});
