# Admin & first-run setup model

Roles in this app are **Firebase Auth custom claims** (`role: "admin"` or
`role: "child"`). Custom claims can only be written with the Admin SDK — that is,
server-side, never from a browser. That's what keeps a child (or a stranger who
signs up) from making themselves an admin. But it creates a chicken-and-egg
problem: **the very first admin has no admin to promote them.** This doc explains
how that's solved and why it's safe.

## The first-run claim

There is **no open admin registration**. Two things gate the first admin: an
operator-authorized *owner-email allowlist*, and disabled public sign-up. Neither
can be set from a browser, so a stranger who finds the URL can do nothing.

### Step 1 — the operator authorizes an owner email (server-side)

Before setup can happen, someone with deploy credentials runs:

```
npx tsx scripts/set-owner.ts owner@example.com
```

This writes `settings/system.ownerEmail`. Firestore rules forbid clients from
writing `settings/*`, so **only someone with Admin SDK access can open setup** —
this is the allowlist. It refuses once the bank is already claimed, so it can't
hand the bank to a new email after the fact (reset the instance to start over).

### Step 2 — the owner claims admin in the browser

Two Cloud Functions handle bootstrapping ([functions/src/userAdmin.ts](../functions/src/userAdmin.ts)):

- **`needsSetup`** (public) — returns only `{ needsSetup, ownerEmailSet }` booleans,
  never the email itself. The first-run UI uses them to decide whether to show the
  **Set up your bank** form (only once an owner email is authorized) or a "setup
  isn't open yet" message. Safe to call before anyone signs in.
- **`bootstrapFirstAdmin`** (public, but allowlist-gated) — takes `{ email, password }`.
  It verifies the email equals the authorized `ownerEmail`, then provisions that
  admin **server-side** (public sign-up is off, so the account can't pre-exist by
  self-registration). Only the allowlisted email can ever succeed.

`bootstrapFirstAdmin` is **self-locking**. A Firestore transaction on
`settings/system`:

1. If `ownerClaimed === true`, it refuses.
2. If no `ownerEmail` is set, it refuses ("setup isn't open").
3. If the caller's email ≠ `ownerEmail`, it refuses (`permission-denied`).
4. As a backstop (in case the flag doc was wiped), if any admin already exists it
   sets the flag and refuses.
5. Otherwise it reserves the claim (`ownerClaimed`, `claimedAt`), then creates the
   owner's admin login (adopting a same-email account if one already exists) and
   stamps `ownerUid`. If provisioning fails, the reservation is rolled back so
   setup can be retried.

Once the first admin is claimed, this function **permanently refuses** — it can
never be used to escalate privileges afterward. The transaction makes concurrent
first calls race-safe: exactly one wins.

### Public sign-up is disabled

`scripts/disable-signup.ts` turns off Identity Platform self-service sign-up, so
the client `accounts:signUp` API returns `ADMIN_ONLY_OPERATION`. Every account is
therefore minted server-side — by the owner bootstrap above or by the admin "Add
user" tool. Run it once per instance as part of deploy (see the [README](../README.md)).

## After setup: managing users in-app

Once you're an admin, **Settings → Logins** ([src/pages/settings.astro](../src/pages/settings.astro))
calls admin-gated functions:

- `createUser` — create a login and assign its role in one step.
- `listUsers` — list all logins and their roles.
- `setUserRole` — change a role. **Refuses to demote the last admin.**
- `deleteUser` — delete a login. **Refuses to delete the last admin, and refuses
  self-deletion.**

Every one of these calls `requireAdmin()` first, so a child token can't invoke
them even by calling the function directly.

> **Role changes take effect on next sign-in.** Custom claims are baked into the
> ID token, so a user whose role you change must sign out and back in (or wait for
> their token to refresh) before it applies.

## Command-line equivalents

Everything above is also doable from the terminal for scripting or recovery — see
the *Optional — command-line admin tools* section of the [README](../README.md).
`scripts/create-user.ts` and `scripts/set-claims.ts` set claims directly via the
Admin SDK, which is the escape hatch if you ever lock yourself out.
