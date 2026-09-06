import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { requireProjectId } from "./_env.js";

/**
 * bank.ts — a safe CLI for reading, searching, analyzing, and (guardedly)
 * editing transaction history. Built for both humans and AI agents.
 *
 *   npx tsx scripts/bank.ts <command> [args] [--flags]
 *
 * The target project comes from .firebaserc (projects.default); no env vars
 * needed. All date math is done in UTC internally to match the deployed Cloud
 * Functions (see docs/validation.md), so the ambient timezone doesn't matter.
 *
 * Reads are always safe. Writes (add/edit/delete) are DRY-RUN by default: they
 * print the exact change plus the projected balance impact and exit without
 * touching anything. Re-run with --confirm to commit. Writes only ever touch the
 * `transactions` subcollection — never the derived `monthly` snapshots or the
 * cached account totals. On a live project the deployed onTransaction* trigger
 * recomputes those automatically; run `scripts/recompute-all.ts` if it isn't.
 *
 * Add --json to any command for machine-readable output.
 *
 * Deleting or overwriting data requires explicit per-operation approval — see the
 * policy in docs/data-safety.md.
 */

type TxType = "deposit" | "withdrawal" | "fine";
const TX_TYPES: TxType[] = ["deposit", "withdrawal", "fine"];

interface Tx {
  id: string;
  type: TxType;
  amount: number;
  memo: string;
  date: Date;
  createdAt?: Date;
}

interface Totals {
  currentBalance: number;
  totalInterest: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalFines: number;
}

// ---- arg parsing ---------------------------------------------------------

function parseArgs(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// ---- date / money helpers (UTC, to match Cloud Functions) ----------------

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function currentMonthKey(): string {
  return monthKey(new Date());
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

// Parse a YYYY-MM-DD date into a Timestamp at noon UTC. Noon avoids landing on a
// month boundary that could bucket into the wrong month (see docs/validation.md).
function parseDate(s: string): Timestamp {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) die(`Invalid date "${s}" — expected YYYY-MM-DD.`);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return Timestamp.fromDate(new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)));
}

// ---- firestore access ----------------------------------------------------

initializeApp({ projectId: requireProjectId() });
const db = getFirestore();

async function loadAccount(accountId: string) {
  const ref = db.collection("accounts").doc(accountId);
  const doc = await ref.get();
  if (!doc.exists) die(`Account "${accountId}" not found.`);
  return { ref, data: doc.data()! };
}

async function loadTx(accountId: string): Promise<Tx[]> {
  const snap = await db
    .collection("accounts")
    .doc(accountId)
    .collection("transactions")
    .orderBy("date", "asc")
    .get();
  return snap.docs.map((d) => {
    const t = d.data();
    return {
      id: d.id,
      type: t.type,
      amount: t.amount,
      memo: t.memo ?? "",
      date: t.date.toDate(),
      createdAt: t.createdAt?.toDate?.(),
    };
  });
}

async function resolveRate(accountId: string): Promise<number> {
  const { data } = await loadAccount(accountId);
  const override = data.rateOverride as number | null;
  const settings = await db.collection("settings").doc("interest").get();
  const defaultRate = settings.exists ? (settings.data()!.defaultRate as number) : 0.02;
  return override ?? defaultRate;
}

// Replay the whole history from zero in UTC (the validation.md method) and
// return the derived totals. Used to preview a write's balance impact without
// trusting — or touching — the cached values.
function replay(txs: Tx[], rate: number): Totals {
  if (txs.length === 0) {
    return { currentBalance: 0, totalInterest: 0, totalDeposits: 0, totalWithdrawals: 0, totalFines: 0 };
  }
  const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime());
  let totalInterest = 0, totalDeposits = 0, totalWithdrawals = 0, totalFines = 0;
  let prevEnd = 0;
  let key = monthKey(sorted[0].date);
  const end = currentMonthKey();
  while (key <= end) {
    const interest = prevEnd > 0 ? prevEnd * rate : 0;
    const start = prevEnd + interest;
    let dep = 0, wd = 0, fn = 0;
    for (const t of sorted) {
      if (monthKey(t.date) !== key) continue;
      if (t.type === "deposit") dep += t.amount;
      else if (t.type === "withdrawal") wd += t.amount;
      else fn += t.amount;
    }
    prevEnd = start + dep - wd - fn;
    totalInterest += interest;
    totalDeposits += dep;
    totalWithdrawals += wd;
    totalFines += fn;
    key = nextMonthKey(key);
  }
  return {
    currentBalance: prevEnd,
    totalInterest,
    totalDeposits,
    totalWithdrawals,
    totalFines,
  };
}

// ---- output --------------------------------------------------------------

let JSON_MODE = false;
function out(human: () => void, json: unknown) {
  if (JSON_MODE) console.log(JSON.stringify(json, null, 2));
  else human();
}

function printTxTable(txs: Tx[]) {
  if (txs.length === 0) {
    console.log("(no matching transactions)");
    return;
  }
  console.log("id                      date        type        amount     memo");
  for (const t of txs) {
    console.log(
      `${t.id.padEnd(22)}  ${isoDate(t.date)}  ${t.type.padEnd(10)}  ${money(t.amount).padStart(9)}  ${t.memo}`
    );
  }
  console.log(`\n${txs.length} transaction(s)`);
}

// ---- commands ------------------------------------------------------------

async function cmdAccounts() {
  const snap = await db.collection("accounts").orderBy("order").get();
  const rows = snap.docs.map((d) => {
    const a = d.data();
    return {
      id: d.id,
      name: a.name,
      currentBalance: a.currentBalance ?? 0,
      totalInterest: a.totalInterest ?? 0,
      totalDeposits: a.totalDeposits ?? 0,
      totalWithdrawals: a.totalWithdrawals ?? 0,
      totalFines: a.totalFines ?? 0,
      rateOverride: a.rateOverride ?? null,
    };
  });
  out(() => {
    console.log("id          name             balance      interest   deposits");
    for (const r of rows) {
      console.log(
        `${r.id.padEnd(10)}  ${String(r.name).padEnd(15)}  ${money(r.currentBalance).padStart(10)}  ${money(r.totalInterest).padStart(9)}  ${money(r.totalDeposits).padStart(9)}`
      );
    }
  }, rows);
}

function applyFilters(txs: Tx[], flags: Record<string, string | boolean>): Tx[] {
  let out = txs;
  const type = flags.type as string | undefined;
  if (type) {
    if (!TX_TYPES.includes(type as TxType)) die(`--type must be one of ${TX_TYPES.join(", ")}.`);
    out = out.filter((t) => t.type === type);
  }
  const from = flags.from as string | undefined;
  const to = flags.to as string | undefined;
  if (from) out = out.filter((t) => isoDate(t.date) >= from);
  if (to) out = out.filter((t) => isoDate(t.date) <= to);
  const search = (flags.search ?? flags.memo) as string | undefined;
  if (search) {
    const re = new RegExp(search, "i");
    out = out.filter((t) => re.test(t.memo));
  }
  const order = (flags.order as string | undefined) ?? "desc";
  out = order === "asc"
    ? out.sort((a, b) => a.date.getTime() - b.date.getTime())
    : out.sort((a, b) => b.date.getTime() - a.date.getTime());
  const limit = flags.limit ? Number(flags.limit) : undefined;
  if (limit && limit > 0) out = out.slice(0, limit);
  return out;
}

async function cmdList(accountId: string, flags: Record<string, string | boolean>) {
  await loadAccount(accountId);
  const txs = applyFilters(await loadTx(accountId), flags);
  out(() => printTxTable(txs), txs.map((t) => ({ ...t, date: isoDate(t.date), createdAt: t.createdAt ? isoDate(t.createdAt) : null })));
}

async function cmdShow(accountId: string, txId: string) {
  await loadAccount(accountId);
  const doc = await db.collection("accounts").doc(accountId).collection("transactions").doc(txId).get();
  if (!doc.exists) die(`Transaction "${txId}" not found in account "${accountId}".`);
  const t = doc.data()!;
  const rec = {
    id: doc.id,
    type: t.type,
    amount: t.amount,
    memo: t.memo ?? "",
    date: isoDate(t.date.toDate()),
    createdAt: t.createdAt?.toDate ? isoDate(t.createdAt.toDate()) : null,
  };
  out(() => console.log(JSON.stringify(rec, null, 2)), rec);
}

async function cmdStats(accountId: string, flags: Record<string, string | boolean>) {
  await loadAccount(accountId);
  const rate = await resolveRate(accountId);
  const txs = applyFilters(await loadTx(accountId), flags);
  const byType = { deposit: 0, withdrawal: 0, fine: 0 };
  const counts = { deposit: 0, withdrawal: 0, fine: 0 };
  const byYear: Record<string, { deposit: number; withdrawal: number; fine: number }> = {};
  for (const t of txs) {
    byType[t.type] += t.amount;
    counts[t.type]++;
    const y = String(t.date.getUTCFullYear());
    byYear[y] ??= { deposit: 0, withdrawal: 0, fine: 0 };
    byYear[y][t.type] += t.amount;
  }
  const derived = replay(await loadTx(accountId), rate); // full-history derived totals (unfiltered)
  const stats = {
    accountId,
    rate,
    transactionCount: txs.length,
    sums: byType,
    counts,
    netTransacted: byType.deposit - byType.withdrawal - byType.fine,
    byYear,
    derived, // independently-replayed balance & totals (all transactions)
  };
  out(() => {
    console.log(`Account: ${accountId}   rate: ${(rate * 100).toFixed(2)}% monthly`);
    console.log(`Transactions (after filters): ${txs.length}`);
    console.log(`  deposits:    ${money(byType.deposit).padStart(11)}  (${counts.deposit})`);
    console.log(`  withdrawals: ${money(byType.withdrawal).padStart(11)}  (${counts.withdrawal})`);
    console.log(`  fines:       ${money(byType.fine).padStart(11)}  (${counts.fine})`);
    console.log(`  net moved:   ${money(stats.netTransacted).padStart(11)}`);
    console.log("\nBy year (deposit / withdrawal / fine):");
    for (const y of Object.keys(byYear).sort()) {
      const v = byYear[y];
      console.log(`  ${y}: ${money(v.deposit)} / ${money(v.withdrawal)} / ${money(v.fine)}`);
    }
    console.log("\nDerived from full history (independent replay, all transactions):");
    console.log(`  currentBalance: ${money(derived.currentBalance)}`);
    console.log(`  totalInterest:  ${money(derived.totalInterest)}`);
  }, stats);
}

// Marginal compounded interest a single deposit has earned, using the historical
// monthly rates actually stamped on each snapshot. Interest starts the month
// AFTER the deposit's effective month and compounds through the latest snapshot.
async function cmdContribution(accountId: string, txId: string) {
  await loadAccount(accountId);
  const doc = await db.collection("accounts").doc(accountId).collection("transactions").doc(txId).get();
  if (!doc.exists) die(`Transaction "${txId}" not found in account "${accountId}".`);
  const t = doc.data()!;
  if (t.type !== "deposit") die(`Transaction ${txId} is a ${t.type}; contribution is defined for deposits.`);
  const depMonth = monthKey(t.date.toDate());
  const monthly = await db.collection("accounts").doc(accountId).collection("monthly").orderBy("__name__").get();
  let factor = 1;
  let lastMonth = depMonth;
  for (const m of monthly.docs) {
    if (m.id > depMonth) {
      factor *= 1 + (m.data().interestRate as number);
      lastMonth = m.id;
    }
  }
  const interest = t.amount * factor - t.amount;
  const rec = {
    id: txId,
    memo: t.memo ?? "",
    amount: t.amount,
    depositMonth: depMonth,
    throughMonth: lastMonth,
    compoundFactor: factor,
    interestEarned: interest,
    valueToday: t.amount * factor,
  };
  out(() => {
    console.log(`Deposit ${txId} — "${rec.memo}"  ${money(rec.amount)} (${depMonth})`);
    console.log(`Compounded through ${lastMonth}: factor ${factor.toFixed(6)}`);
    console.log(`Interest earned from this deposit: ${money(interest)}`);
    console.log(`Value today: ${money(rec.valueToday)}`);
  }, rec);
}

function previewImpact(before: Totals, after: Totals) {
  const d = (k: keyof Totals) => after[k] - before[k];
  return {
    currentBalance: { before: before.currentBalance, after: after.currentBalance, delta: d("currentBalance") },
    totalDeposits: { before: before.totalDeposits, after: after.totalDeposits, delta: d("totalDeposits") },
    totalWithdrawals: { before: before.totalWithdrawals, after: after.totalWithdrawals, delta: d("totalWithdrawals") },
    totalFines: { before: before.totalFines, after: after.totalFines, delta: d("totalFines") },
    totalInterest: { before: before.totalInterest, after: after.totalInterest, delta: d("totalInterest") },
  };
}

function printImpact(action: string, tx: Partial<Tx>, impact: ReturnType<typeof previewImpact>, confirmed: boolean) {
  console.log(`${confirmed ? "APPLIED" : "DRY RUN"} — ${action}`);
  console.log(`  ${tx.type ?? ""} ${tx.amount != null ? money(tx.amount) : ""} ${tx.date ? isoDate(tx.date) : ""} "${tx.memo ?? ""}"`.trim());
  console.log("  Projected impact (independent replay):");
  for (const [k, v] of Object.entries(impact)) {
    if (Math.abs(v.delta) < 0.005) continue;
    const sign = v.delta >= 0 ? "+" : "";
    console.log(`    ${k.padEnd(16)} ${money(v.before)} -> ${money(v.after)}  (${sign}${money(v.delta)})`);
  }
  if (!confirmed) console.log("\nNo changes written. Re-run with --confirm to apply.");
  else console.log("\nWritten. The deployed onTransaction* trigger recomputes snapshots automatically.");
}

async function cmdAdd(accountId: string, flags: Record<string, string | boolean>) {
  await loadAccount(accountId);
  const type = flags.type as string;
  const amount = Number(flags.amount);
  const memo = (flags.memo as string) ?? "";
  const dateStr = flags.date as string;
  if (!TX_TYPES.includes(type as TxType)) die(`--type must be one of ${TX_TYPES.join(", ")}.`);
  if (!(amount > 0)) die("--amount must be a positive number (sign is implied by --type).");
  if (!dateStr) die("--date YYYY-MM-DD is required.");
  const ts = parseDate(dateStr);
  const rate = await resolveRate(accountId);
  const existing = await loadTx(accountId);
  const newTx: Tx = { id: "(new)", type: type as TxType, amount, memo, date: ts.toDate() };
  const before = replay(existing, rate);
  const after = replay([...existing, newTx], rate);
  const impact = previewImpact(before, after);
  const confirmed = flags.confirm === true;
  if (confirmed) {
    await db.collection("accounts").doc(accountId).collection("transactions").add({
      type, amount, memo, date: ts, createdAt: Timestamp.now(),
    });
  }
  out(() => printImpact("add transaction", newTx, impact, confirmed),
    { action: "add", confirmed, transaction: { type, amount, memo, date: dateStr }, impact });
}

async function cmdEdit(accountId: string, txId: string, flags: Record<string, string | boolean>) {
  await loadAccount(accountId);
  const ref = db.collection("accounts").doc(accountId).collection("transactions").doc(txId);
  const doc = await ref.get();
  if (!doc.exists) die(`Transaction "${txId}" not found in account "${accountId}".`);
  const cur = doc.data()!;
  const update: Record<string, unknown> = {};
  if (flags.type !== undefined) {
    if (!TX_TYPES.includes(flags.type as TxType)) die(`--type must be one of ${TX_TYPES.join(", ")}.`);
    update.type = flags.type;
  }
  if (flags.amount !== undefined) {
    const a = Number(flags.amount);
    if (!(a > 0)) die("--amount must be a positive number.");
    update.amount = a;
  }
  if (flags.memo !== undefined) update.memo = String(flags.memo);
  if (flags.date !== undefined) update.date = parseDate(flags.date as string);
  if (Object.keys(update).length === 0) die("Nothing to change. Provide at least one of --type/--amount/--memo/--date.");

  const rate = await resolveRate(accountId);
  const existing = await loadTx(accountId);
  const edited = existing.map((t): Tx =>
    t.id === txId
      ? {
          ...t,
          type: (update.type as TxType) ?? t.type,
          amount: (update.amount as number) ?? t.amount,
          memo: update.memo !== undefined ? (update.memo as string) : t.memo,
          date: update.date ? (update.date as Timestamp).toDate() : t.date,
        }
      : t
  );
  const impact = previewImpact(replay(existing, rate), replay(edited, rate));
  const confirmed = flags.confirm === true;
  if (confirmed) await ref.update(update);
  const shown = edited.find((t) => t.id === txId)!;
  out(() => printImpact(`edit ${txId} (was ${cur.type} ${money(cur.amount)} ${isoDate(cur.date.toDate())})`, shown, impact, confirmed),
    { action: "edit", txId, confirmed, changes: { ...update, date: update.date ? isoDate((update.date as Timestamp).toDate()) : undefined }, impact });
}

async function cmdDelete(accountId: string, txId: string, flags: Record<string, string | boolean>) {
  await loadAccount(accountId);
  const ref = db.collection("accounts").doc(accountId).collection("transactions").doc(txId);
  const doc = await ref.get();
  if (!doc.exists) die(`Transaction "${txId}" not found in account "${accountId}".`);
  const cur = doc.data()!;
  const rate = await resolveRate(accountId);
  const existing = await loadTx(accountId);
  const impact = previewImpact(replay(existing, rate), replay(existing.filter((t) => t.id !== txId), rate));
  const confirmed = flags.confirm === true;
  if (confirmed) await ref.delete();
  const shown: Partial<Tx> = { type: cur.type, amount: cur.amount, memo: cur.memo, date: cur.date.toDate() };
  out(() => printImpact(`delete ${txId}`, shown, impact, confirmed),
    { action: "delete", txId, confirmed, deleted: { type: cur.type, amount: cur.amount, memo: cur.memo, date: isoDate(cur.date.toDate()) }, impact });
}

// ---- dispatch ------------------------------------------------------------

const HELP = `bank.ts — safe transaction-history CLI

Usage: npx tsx scripts/bank.ts <command> [args] [--flags]   (project from .firebaserc)

Read / find:
  accounts                                 List accounts with balances & totals
  list <account> [filters]                 List transactions (newest first)
  find <account> <regex>                   Search memos (case-insensitive)
  show <account> <txId>                    Show one transaction

Analytics:
  stats <account> [filters]                Sums, counts, by-year, replayed balance
  contribution <account> <txId>            Compounded interest a deposit has earned

Write (DRY RUN unless --confirm):
  add <account> --type T --amount N --date YYYY-MM-DD [--memo "..."]
  edit <account> <txId> [--type T] [--amount N] [--date D] [--memo "..."]
  delete <account> <txId>

Filters (list/stats): --type deposit|withdrawal|fine  --from YYYY-MM-DD  --to YYYY-MM-DD
                       --search <regex>  --limit N  --order asc|desc
Global: --json (machine-readable)  --confirm (commit a write)

Writes touch only the transactions subcollection; the deployed trigger recomputes
snapshots & totals.`;

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  JSON_MODE = flags.json === true;
  const [cmd, ...rest] = positionals;

  switch (cmd) {
    case "accounts": return cmdAccounts();
    case "list": return cmdList(need(rest[0], "account"), flags);
    case "find": {
      const acct = need(rest[0], "account");
      const re = need(rest[1], "regex");
      return cmdList(acct, { ...flags, search: re });
    }
    case "show": return cmdShow(need(rest[0], "account"), need(rest[1], "txId"));
    case "stats": return cmdStats(need(rest[0], "account"), flags);
    case "contribution": return cmdContribution(need(rest[0], "account"), need(rest[1], "txId"));
    case "add": return cmdAdd(need(rest[0], "account"), flags);
    case "edit": return cmdEdit(need(rest[0], "account"), need(rest[1], "txId"), flags);
    case "delete": return cmdDelete(need(rest[0], "account"), need(rest[1], "txId"), flags);
    case undefined:
    case "help":
    case "--help":
      console.log(HELP);
      return;
    default:
      die(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

function need(v: string | undefined, name: string): string {
  if (!v) die(`Missing required <${name}>.\n\n${HELP}`);
  return v;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });
