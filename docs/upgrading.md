# Upgrading an existing instance

This is for instances **already deployed and set up** (you have an admin and live
data) that are pulling newer code. Fresh installs should follow the [README](../README.md)
setup instead — this page only lists the extra actions an existing instance needs
so a `git pull` + `npm run deploy` doesn't break or leave it unhardened.

## The routine

```bash
git pull
npm install && npm --prefix functions install   # if dependencies changed
npm run deploy
```

Then check the list below for any entry dated **after your last upgrade** and run
its one-time action. Entries are newest first; each is idempotent and safe to
re-run. Your live data (accounts, transactions, balances) is never touched by any
of these.

---

## 2026-09-06 — Hosting deploy target (**required, do before deploying**)

`firebase.json` now deploys through a generic `app` Hosting target instead of the
project's default site. Existing `.firebaserc` files don't define it, so
`npm run deploy` fails with a "target not applied" error until you map it once:

```bash
firebase target:apply hosting app <your-site-id>
```

Use your Project ID as `<your-site-id>` to keep deploying to the same
`https://<project-id>.web.app` you already use. (To move to a friendlier
`<alias>.web.app`, see the alias steps in [README step 5](../README.md#step-5--get-the-code-and-point-it-at-your-project).)
This only edits your gitignored `.firebaserc`; nothing deploys and the live site is
unchanged until your next `npm run deploy`.

## 2026-09-06 — Disable public sign-up (**recommended hardening**)

Older instances left Identity Platform self-service sign-up on, so anyone could
create a login (they'd land on a no-access screen, but it's needless surface). Turn
it off — all accounts are now minted server-side by the owner bootstrap and the
admin "Add user" tool:

```bash
npx tsx scripts/disable-signup.ts
```

After this, the client `accounts:signUp` API returns `ADMIN_ONLY_OPERATION`. See
[docs/admin-model.md](admin-model.md) for the full first-run security model.

> **No owner-email step needed here.** The new owner-email allowlist
> (`scripts/set-owner.ts`) only gates *first* setup. An instance that already has an
> admin is past that point — `needsSetup` is already `false` — so the bootstrap
> changes are a no-op for you.
