import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { requireProjectId } from "./_env.js";

initializeApp({ projectId: requireProjectId() });
const db = getFirestore();

interface Transaction {
  date: Timestamp;
  type: "deposit" | "withdrawal" | "fine";
  amount: number;
}

function getMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getNextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

async function recomputeAccount(accountId: string) {
  const accountRef = db.collection("accounts").doc(accountId);
  const accountDoc = await accountRef.get();
  if (!accountDoc.exists) return;

  const accountData = accountDoc.data()!;
  const rateOverride = accountData.rateOverride as number | null;

  const settingsDoc = await db.collection("settings").doc("interest").get();
  const defaultRate = settingsDoc.exists
    ? (settingsDoc.data()!.defaultRate as number)
    : 0.02;

  const rate = rateOverride ?? defaultRate;

  const transactionsSnap = await accountRef
    .collection("transactions")
    .orderBy("date", "asc")
    .get();

  const allTransactions = transactionsSnap.docs.map((doc) => {
    const data = doc.data() as Transaction;
    return {
      ...data,
      monthKey: getMonthKey(data.date.toDate()),
    };
  });

  if (allTransactions.length === 0) {
    console.log(`  No transactions, skipping.`);
    return;
  }

  // Delete existing monthly docs
  const existingMonthly = await accountRef.collection("monthly").get();
  if (!existingMonthly.empty) {
    const deleteBatch = db.batch();
    existingMonthly.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
  }

  // Find the range of months
  const firstMonth = allTransactions[0].monthKey;
  const now = new Date();
  const currentMonthKey = getMonthKey(now);

  let totalInterest = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalFines = 0;
  let prevEndBalance = 0;

  let monthKey = firstMonth;
  const batches: FirebaseFirestore.WriteBatch[] = [db.batch()];
  let batchOps = 0;

  while (monthKey <= currentMonthKey) {
    const interestEarned = prevEndBalance > 0 ? prevEndBalance * rate : 0;
    const startBalance = prevEndBalance + interestEarned;

    const monthTransactions = allTransactions.filter(
      (t) => t.monthKey === monthKey
    );

    let monthDeposits = 0;
    let monthWithdrawals = 0;
    let monthFines = 0;

    for (const t of monthTransactions) {
      switch (t.type) {
        case "deposit":
          monthDeposits += t.amount;
          break;
        case "withdrawal":
          monthWithdrawals += t.amount;
          break;
        case "fine":
          monthFines += t.amount;
          break;
      }
    }

    const endBalance = startBalance + monthDeposits - monthWithdrawals - monthFines;

    const monthRef = accountRef.collection("monthly").doc(monthKey);
    let currentBatch = batches[batches.length - 1];
    if (batchOps >= 450) {
      currentBatch = db.batch();
      batches.push(currentBatch);
      batchOps = 0;
    }
    currentBatch.set(monthRef, {
      startBalance,
      endBalance,
      interestRate: rate,
      interestEarned,
      totalDeposits: monthDeposits,
      totalWithdrawals: monthWithdrawals,
      totalFines: monthFines,
      transactionCount: monthTransactions.length,
    });
    batchOps++;

    totalInterest += interestEarned;
    totalDeposits += monthDeposits;
    totalWithdrawals += monthWithdrawals;
    totalFines += monthFines;
    prevEndBalance = endBalance;

    monthKey = getNextMonthKey(monthKey);
  }

  // Update account doc
  const lastBatch = batches[batches.length - 1];
  lastBatch.update(accountRef, {
    currentBalance: prevEndBalance,
    totalInterest,
    totalDeposits,
    totalWithdrawals,
    totalFines,
    lastComputedAt: Timestamp.now(),
  });

  for (const batch of batches) {
    await batch.commit();
  }

  console.log(`  Balance: $${prevEndBalance.toFixed(2)}, Interest: $${totalInterest.toFixed(2)}`);
}

async function main() {
  const accountsSnap = await db.collection("accounts").get();

  for (const doc of accountsSnap.docs) {
    console.log(`Recomputing ${doc.data().name}...`);
    await recomputeAccount(doc.id);
  }

  console.log("\nDone! All accounts recomputed.");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
