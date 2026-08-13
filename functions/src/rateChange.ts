import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { recomputeFromMonth } from "./recompute.js";

interface RateChangeData {
  rate: number;
  effectiveMonth: string;
  accountId?: string;
}

export const changeRate = onCall(async (request) => {
  if (request.auth?.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only");
  }

  const { rate, effectiveMonth, accountId } = request.data as RateChangeData;

  if (typeof rate !== "number" || rate < 0 || rate > 1) {
    throw new HttpsError("invalid-argument", "Rate must be between 0 and 1");
  }

  if (!/^\d{4}-\d{2}$/.test(effectiveMonth)) {
    throw new HttpsError("invalid-argument", "effectiveMonth must be YYYY-MM");
  }

  const db = getFirestore();

  if (accountId) {
    await db.collection("accounts").doc(accountId).update({ rateOverride: rate });
    await recomputeFromMonth(accountId, effectiveMonth);
  } else {
    await db.collection("settings").doc("interest").set({ defaultRate: rate });
    const accountsSnap = await db.collection("accounts").get();
    for (const doc of accountsSnap.docs) {
      if (doc.data().rateOverride == null) {
        await recomputeFromMonth(doc.id, effectiveMonth);
      }
    }
  }

  return { success: true };
});
