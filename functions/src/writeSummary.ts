import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export async function writeSummary(): Promise<void> {
  const db = getFirestore();

  const settingsDoc = await db.collection("settings").doc("api").get();
  if (!settingsDoc.exists) return;
  const summaryPath = settingsDoc.data()!.summaryPath as string;
  if (!summaryPath) return;

  const accountsSnap = await db.collection("accounts").orderBy("order").get();

  let totalBalance = 0;
  const accounts = accountsSnap.docs.map((doc, i) => {
    const data = doc.data();
    const balance = data.currentBalance as number;
    totalBalance += balance;
    return {
      id: `child_${i}`,
      balance,
      totalInterest: data.totalInterest as number,
      totalDeposits: data.totalDeposits as number,
      totalWithdrawals: data.totalWithdrawals as number,
      totalFines: data.totalFines as number,
      interestRate: data.rateOverride ?? null,
    };
  });

  const summary = {
    accounts,
    totalBalance,
    updatedAt: new Date().toISOString(),
  };

  const bucket = getStorage().bucket();
  const file = bucket.file(summaryPath);
  await file.save(JSON.stringify(summary, null, 2), {
    contentType: "application/json",
    metadata: {
      cacheControl: "public, max-age=300",
    },
  });
}
