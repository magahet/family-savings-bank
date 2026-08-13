import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { writeSummary } from "./writeSummary.js";

export const monthlyInterest = onSchedule("0 0 1 * *", async () => {
  const db = getFirestore();
  const settingsDoc = await db.collection("settings").doc("interest").get();
  const defaultRate = settingsDoc.exists
    ? (settingsDoc.data()!.defaultRate as number)
    : 0.02;

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, "0")}`;

  const accountsSnap = await db.collection("accounts").get();

  for (const accountDoc of accountsSnap.docs) {
    const accountData = accountDoc.data();
    const rate = (accountData.rateOverride as number | null) ?? defaultRate;

    const prevSnap = await accountDoc.ref
      .collection("monthly")
      .doc(prevMonthKey)
      .get();

    let prevEndBalance = 0;
    if (prevSnap.exists) {
      prevEndBalance = prevSnap.data()!.endBalance as number;
    }

    const interestEarned = prevEndBalance > 0 ? prevEndBalance * rate : 0;
    const startBalance = prevEndBalance + interestEarned;

    const currentSnap = await accountDoc.ref
      .collection("monthly")
      .doc(currentMonthKey)
      .get();

    if (!currentSnap.exists) {
      await accountDoc.ref.collection("monthly").doc(currentMonthKey).set({
        startBalance,
        endBalance: startBalance,
        interestRate: rate,
        interestEarned,
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalFines: 0,
        transactionCount: 0,
      });
    }

    await accountDoc.ref.update({
      currentBalance: (accountData.currentBalance as number) + interestEarned,
      totalInterest: (accountData.totalInterest as number) + interestEarned,
      lastComputedAt: Timestamp.now(),
    });
  }

  await writeSummary();
});
