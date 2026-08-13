import { getFirestore, Timestamp } from "firebase-admin/firestore";

interface Transaction {
  date: Timestamp;
  type: "deposit" | "withdrawal" | "fine";
  amount: number;
}

interface MonthlySnapshot {
  startBalance: number;
  endBalance: number;
  interestRate: number;
  interestEarned: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalFines: number;
  transactionCount: number;
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

function getCurrentMonthKey(): string {
  return getMonthKey(new Date());
}

export async function recomputeFromMonth(
  accountId: string,
  fromMonthKey: string
): Promise<void> {
  const db = getFirestore();
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

  const allTransactions = transactionsSnap.docs.map((doc) => ({
    ...(doc.data() as Transaction),
    monthKey: getMonthKey(doc.data().date.toDate()),
  }));

  const monthlySnap = await accountRef
    .collection("monthly")
    .orderBy("__name__")
    .get();

  const existingMonthly = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const doc of monthlySnap.docs) {
    existingMonthly.set(doc.id, doc.ref);
  }

  let prevEndBalance = 0;
  let prevInterestEarned = 0;

  const monthBeforeFrom = getPrevMonthKey(fromMonthKey);
  const monthBeforeDoc = await accountRef
    .collection("monthly")
    .doc(monthBeforeFrom)
    .get();
  if (monthBeforeDoc.exists) {
    const data = monthBeforeDoc.data()!;
    prevEndBalance = data.endBalance as number;
    prevInterestEarned = data.endBalance > 0 ? data.endBalance * rate : 0;
  }

  const currentMonthKey = getCurrentMonthKey();
  const batch = db.batch();
  let totalInterest = 0;
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let totalFines = 0;

  const allMonthsBefore = monthlySnap.docs.filter(
    (doc) => doc.id < fromMonthKey
  );
  for (const doc of allMonthsBefore) {
    const data = doc.data();
    totalInterest += data.interestEarned as number;
    totalDeposits += data.totalDeposits as number;
    totalWithdrawals += data.totalWithdrawals as number;
    totalFines += data.totalFines as number;
  }

  let monthKey = fromMonthKey;
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

    const endBalance =
      startBalance + monthDeposits - monthWithdrawals - monthFines;

    const snapshot: MonthlySnapshot = {
      startBalance,
      endBalance,
      interestRate: rate,
      interestEarned,
      totalDeposits: monthDeposits,
      totalWithdrawals: monthWithdrawals,
      totalFines: monthFines,
      transactionCount: monthTransactions.length,
    };

    const monthRef = accountRef.collection("monthly").doc(monthKey);
    batch.set(monthRef, snapshot);

    totalInterest += interestEarned;
    totalDeposits += monthDeposits;
    totalWithdrawals += monthWithdrawals;
    totalFines += monthFines;

    prevEndBalance = endBalance;
    monthKey = getNextMonthKey(monthKey);
  }

  batch.update(accountRef, {
    currentBalance: prevEndBalance,
    totalInterest,
    totalDeposits,
    totalWithdrawals,
    totalFines,
    lastComputedAt: Timestamp.now(),
  });

  await batch.commit();
}

function getPrevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function getMonthKeyFromTimestamp(ts: Timestamp): string {
  return getMonthKey(ts.toDate());
}
