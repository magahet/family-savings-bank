import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";

initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-savings-bank" });
const db = getFirestore();
const auth = getAuth();

// Create test admin user
try {
  await auth.createUser({ uid: "test-admin", email: "test@test.com", password: "test1234" });
  await auth.setCustomUserClaims("test-admin", { role: "admin" });
  console.log("Created test admin: test@test.com / test1234");
} catch (e: any) {
  if (e.code !== "auth/uid-already-exists") throw e;
  console.log("Test admin already exists");
}

// Seed settings
await db.collection("settings").doc("interest").set({ defaultRate: 0.02 });

// Seed a couple accounts with sample data
const kids = [
  { id: "alice", name: "Alice", balance: 2153.54 },
  { id: "bob", name: "Bob", balance: -88.36 },
  { id: "cora", name: "Cora", balance: 365.71 },
];

for (const kid of kids) {
  const ref = db.collection("accounts").doc(kid.id);
  await ref.set({
    name: kid.name,
    rateOverride: null,
    currentBalance: kid.balance,
    totalInterest: 100,
    totalDeposits: 500,
    totalWithdrawals: 200,
    totalFines: 50,
    lastComputedAt: Timestamp.now(),
  });

  // Add some sample transactions
  const txs = [
    { date: new Date(2026, 3, 15), memo: "Card", type: "withdrawal", amount: 20 },
    { date: new Date(2026, 3, 4), memo: "Amazon gift card", type: "deposit", amount: 25 },
    { date: new Date(2026, 3, 1), memo: "No chores", type: "fine", amount: 20 },
    { date: new Date(2026, 2, 22), memo: "Didn't finish chores", type: "fine", amount: 14 },
    { date: new Date(2026, 2, 15), memo: "Card", type: "withdrawal", amount: 20 },
    { date: new Date(2026, 2, 4), memo: "Birthday gift", type: "deposit", amount: 75 },
    { date: new Date(2026, 1, 13), memo: "Card", type: "withdrawal", amount: 40 },
    { date: new Date(2026, 1, 7), memo: "Chores", type: "fine", amount: 20 },
    { date: new Date(2026, 0, 18), memo: "Grade bonus", type: "deposit", amount: 270 },
  ];

  for (const tx of txs) {
    await ref.collection("transactions").add({
      date: Timestamp.fromDate(tx.date),
      memo: tx.memo,
      type: tx.type,
      amount: tx.amount,
      createdAt: Timestamp.now(),
    });
  }

  // Add monthly snapshots
  const months = [
    { id: "2026-01", startBalance: kid.balance - 200, endBalance: kid.balance - 100, interestEarned: 10, interestRate: 0.02, totalDeposits: 270, totalWithdrawals: 0, totalFines: 0, transactionCount: 1 },
    { id: "2026-02", startBalance: kid.balance - 100, endBalance: kid.balance - 50, interestEarned: 12, interestRate: 0.02, totalDeposits: 75, totalWithdrawals: 40, totalFines: 20, transactionCount: 3 },
    { id: "2026-03", startBalance: kid.balance - 50, endBalance: kid.balance + 10, interestEarned: 14, interestRate: 0.02, totalDeposits: 75, totalWithdrawals: 20, totalFines: 14, transactionCount: 3 },
    { id: "2026-04", startBalance: kid.balance + 10, endBalance: kid.balance, interestEarned: 15, interestRate: 0.02, totalDeposits: 25, totalWithdrawals: 20, totalFines: 20, transactionCount: 3 },
  ];

  for (const m of months) {
    await ref.collection("monthly").doc(m.id).set(m);
  }
}

console.log("Seeded emulator with test data");
