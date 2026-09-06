import { execFileSync } from "node:child_process";
import { requireProjectId } from "./_env.js";

// Turn OFF public self-service sign-up (Identity Platform "Enable create") so the
// only way to mint an account is server-side — the setup screen's owner bootstrap
// and the admin "Add user" tool, both of which use the Admin SDK. Sign-IN stays on.
//
//   npx tsx scripts/disable-signup.ts            # disable public sign-up (default)
//   npx tsx scripts/disable-signup.ts --enable   # re-enable it (rarely needed)
//
// This is part of a hardened deploy — run it once per instance after `firebase
// deploy`. Uses your gcloud Application Default Credentials for the access token.
const project = requireProjectId();
const enable = process.argv.includes("--enable");
const disabledUserSignup = !enable;

const token = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], {
  encoding: "utf8",
}).trim();

const res = await fetch(
  `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config` +
    `?updateMask=client.permissions.disabledUserSignup`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-goog-user-project": project,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ client: { permissions: { disabledUserSignup } } }),
  }
);

if (!res.ok) {
  console.error(`Failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}
const perms = (await res.json())?.client?.permissions ?? {};
console.log(
  `${project}: public self-service sign-up is now ${perms.disabledUserSignup ? "DISABLED" : "ENABLED"}.`
);
