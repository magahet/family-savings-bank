# Validating a balance

Balances are **derived**, not stored as a running total: `currentBalance` and the
`totalInterest / totalDeposits / totalWithdrawals / totalFines` on each account doc
are a cache produced by replaying every transaction through the monthly-interest
algorithm (see [How It Works → Interest](../README.md#interest)). To validate that a
cached balance is correct, replay the transactions **independently** and compare.

## The one rule that matters: run in UTC

`getMonthKey` buckets each transaction into a `YYYY-MM` month using the **local**
timezone of whatever process runs it. Cloud Functions (the triggers and the monthly
cron that write the real snapshots) run in **UTC**. So any validation must also run in
UTC, or transactions dated on a month boundary — e.g. `2023-09-01T00:00Z` — get bucketed
into a different month than the app used, producing a **phantom discrepancy** that is an
artifact of your machine's timezone, not a real bug.

Always prefix validation runs with `TZ=UTC`:

```bash
TZ=UTC GCLOUD_PROJECT=mendiola-bank npx tsx scripts/local/<your-check>.ts
```

If a validation shows a mismatch, **re-run with `TZ=UTC` before concluding anything is
wrong.** A drift that appears in local time and vanishes in UTC is a bucketing artifact,
not corruption.

## The method

1. **Read the inputs from the source of truth (Firestore), not a spreadsheet.** The
   spreadsheet is historical; the app's transactions are authoritative. Pull
   `accounts/{id}` (for the stored totals) and `accounts/{id}/transactions` ordered by
   `date` ascending.
2. **Replay the exact algorithm.** Use the same logic as
   [`recompute.ts`](../functions/src/recompute.ts) /
   [`scripts/recompute-all.ts`](../scripts/recompute-all.ts): start from month zero with
   `prevEndBalance = 0`, walk every month from the first transaction to the current
   month, and for each month:
   - `interestEarned = prevEndBalance > 0 ? prevEndBalance * rate : 0`
   - `startBalance = prevEndBalance + interestEarned`
   - `endBalance = startBalance + deposits − withdrawals − fines`
   - carry `endBalance` into the next month (interest compounds; empty months still grow)
   - resolve `rate` as `account.rateOverride ?? settings/interest.defaultRate`
3. **Replay from inception, not from a seed.** The live trigger path
   (`recomputeFromMonth`) is a *partial* recompute: it rebuilds only from the changed
   transaction's month forward and trusts the previous month's stored snapshot as its
   starting balance. A validation must **not** do that — start at `prevEndBalance = 0` and
   replay the whole history, so you're checking the app rather than trusting the same
   cached value you're trying to verify.
4. **Compare all five figures**, not just the balance: `currentBalance`, `totalInterest`,
   `totalDeposits`, `totalWithdrawals`, `totalFines`. If deposits/withdrawals/fines match
   but interest/balance don't, the transaction set is fine and the difference is in the
   interest chain (check timezone first, then rate history).

## Interpreting a real mismatch

If figures still differ under `TZ=UTC`:

- **Deposits/withdrawals/fines differ** → the transaction *set* differs (a row was added,
  edited, or deleted since the cache was last written). Fix by rebuilding the cache.
- **Only interest/balance differ** → the monthly interest chain drifted. The forward-only
  trigger recompute never re-derives earlier months, so a stale early snapshot compounds
  forward and never self-heals. Fix by replaying from zero.
- **The fix, either way:** `GCLOUD_PROJECT=<project> npx tsx scripts/recompute-all.ts`
  rebuilds every monthly snapshot and cached total from the transactions — the same
  from-zero replay this validation performs. It writes to production, so confirm first.

## Notes

- `transactions.createdAt` records when a row was *written*, not its effective `date`.
  It cannot date "when a balance went wrong" if the ledger was bulk-imported — every row
  shares the import timestamp. It only distinguishes genuinely real-time entries.
- Firestore PITR is 7 days and Cloud Logging retention is ~30 days, so neither is a usable
  audit trail for older changes.
- One-off validation scripts belong in `scripts/local/` (gitignored). See the
  [Scripts](../README.md#scripts) section.
