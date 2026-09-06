# Data safety — deletions and overwrites require explicit approval

**No operation that deletes or overwrites stored data runs without explicit,
per-operation approval from a human operator.** This applies to anyone — a person
at a terminal or an AI assistant helping manage the bank. This page is the policy
and the reason the tools behave the way they do.

## What counts as destructive

Any write that removes or replaces data that already exists:

- deleting or editing a **transaction** (an edit overwrites the old values)
- deleting an **account**, or overwriting an existing account doc
- deleting a **login** or changing a user's **role**
- overwriting **settings** (interest rate, system flags)
- deleting **monthly snapshots**
- any **reset** or **bulk** operation that touches more than one record

Creating brand-new records (a new account, a first-time setting, adding a login)
is not destructive and is not covered here — though the tools still show you what
they'll do first.

## The rules

1. **Dry-run by default.** Destructive scripts preview exactly what would change —
   which project, which records, and the before/after — and change **nothing**
   until you re-run with `--confirm`.
2. **Confirm is per-operation.** Approving one deletion does not approve the next.
   Each destructive run needs its own explicit go-ahead. There is no "yes to all."
3. **The target project is shown and, for resets, typed back.** Every run prints the
   target project ID (read from `.firebaserc`). Whole-instance resets additionally
   require you to type the project ID, so you cannot wipe the wrong instance by
   muscle memory.
4. **Back up before bulk destruction.** Before a reset or bulk delete on an instance
   that holds real data, export first (see below).
5. **An assistant must get an explicit human "yes" before the `--confirm` run** — and
   must first state the exact scope: target project, what will be deleted/overwritten,
   and how many records. Silence is not approval.

## Backups before destructive bulk operations

```bash
firebase auth:export users-backup.json --project <project-id>   # Auth users
# Firestore: use the console export, or a scripts/local snapshot dump.
```

Keep backups out of git (`data/` and `scripts/local/` are gitignored).

## Tools that follow this policy

- **[`scripts/bank.ts`](../scripts/bank.ts)** — transaction history (add/edit/delete).
  Dry-run unless `--confirm`; only ever touches the `transactions` subcollection and
  previews the resulting balance via an independent replay.
- **`scripts/local/reset-instance.ts`** — wipes an instance back to first-run state
  (Auth users + `settings/system`, optionally accounts/transactions). Dry-run unless
  `--confirm`, and requires typing the target project ID. Lives in gitignored
  `scripts/local/` because it is destructive and instance-specific — never published.

## Deleting an account from the app

**Settings → Accounts** lets an admin delete an account (and all its transactions)
from the browser. The same "no accidental loss" principle applies, enforced in the
UI and on the server:

1. **Archive first.** The dashboard only offers *Archive*, which hides the account
   but keeps every record. Permanent deletion is only offered for already-archived
   accounts, from a separate **Archived accounts** panel. The `deleteAccount`
   function ([functions/src/accountAdmin.ts](../functions/src/accountAdmin.ts))
   refuses (`failed-precondition`) unless `archived === true`, so a client can't
   skip the archive step even by calling the function directly.
2. **Export offered before deletion.** The permanent-delete flow first offers to
   download a JSON backup of just that account.
3. **Type the name to confirm.** Deletion proceeds only after the operator types the
   account's exact name.
4. **Admin-only, server-side, recursive.** Firestore rules deny client `delete` on
   accounts entirely (`allow delete: if false`); removal goes through the admin-gated
   function, which uses `recursiveDelete` so the `transactions` and `monthly`
   subcollections are removed too.

Every admin can also self-serve a copy of their data any time from **Settings → Your
data**: a full JSON backup (all accounts, transactions, monthly snapshots, and the
interest rate) or a combined transactions CSV for a spreadsheet.

See also [validation.md](validation.md) for verifying a balance is correct before
and after any edit.
