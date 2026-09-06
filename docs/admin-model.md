# Admin & first-run setup model

Roles in this app are **Firebase Auth custom claims** (`role: "admin"` or
`role: "child"`). Custom claims can only be written with the Admin SDK — that is,
server-side, never from a browser. That's what keeps a child (or a stranger who
signs up) from making themselves an admin. But it creates a chicken-and-egg
problem: **the very first admin has no admin to promote them.** This doc explains
how that's solved and why it's safe.

## The first-run claim

Two Cloud Functions handle bootstrapping ([functions/src/userAdmin.ts](../functions/src/userAdmin.ts)):

- **`needsSetup`** (public) — returns only `{ needsSetup: boolean }`. It's `true`
  when no owner has been claimed *and* no admin exists. The first-run UI calls it
  to decide whether to show the **Set up your bank** panel. It reveals nothing
  sensitive, so it's safe to call before anyone signs in.
- **`bootstrapFirstAdmin`** (requires sign-in) — promotes the **caller** to admin,
  but only while the bank has no admin yet.

`bootstrapFirstAdmin` is **self-locking**. It runs a Firestore transaction on
`settings/system`:

1. If `ownerClaimed === true`, it refuses.
2. As a backstop (in case the flag doc was wiped), if any admin already exists it
   sets the flag and refuses.
3. Otherwise it stamps `ownerClaimed`, `ownerUid`, and `claimedAt`, then sets the
   caller's `role: "admin"` claim.

Once the first admin is claimed, this function **permanently refuses** — it can
never be used to escalate privileges afterward. The transaction makes concurrent
first calls race-safe: exactly one wins.

### The setup window

Before the first admin exists, the setup screen lets anyone create a login and
claim ownership. In practice you deploy and immediately claim it yourself, so the
window is seconds long. If you want zero exposure, claim ownership before sharing
the URL, or pre-create your login in the Firebase Console first — the setup screen
signs into an existing login too.

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
