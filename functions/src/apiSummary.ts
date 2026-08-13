import { onRequest } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";

const apiKey = defineSecret("API_KEY");

export const apiSummary = onRequest({ secrets: [apiKey], invoker: "public" }, async (req, res) => {
  const providedKey = req.headers["x-api-key"];
  if (!providedKey || providedKey !== apiKey.value()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const db = getFirestore();
  const accountsSnap = await db.collection("accounts").get();

  let totalBalance = 0;
  const accounts = accountsSnap.docs.map((doc, i) => {
    const data = doc.data();
    totalBalance += data.currentBalance as number;
    return {
      id: `child_${i}`,
      balance: data.currentBalance as number,
      totalInterest: data.totalInterest as number,
      totalDeposits: data.totalDeposits as number,
      totalWithdrawals: data.totalWithdrawals as number,
      totalFines: data.totalFines as number,
      interestRate: data.rateOverride ?? null,
    };
  });

  res.json({
    accounts,
    totalBalance,
    updatedAt: new Date().toISOString(),
  });
});
