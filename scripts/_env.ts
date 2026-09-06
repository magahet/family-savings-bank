import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Resolve the target Firebase project ID for admin scripts.
//
// Order of precedence:
//   1. GCLOUD_PROJECT / FIREBASE_PROJECT env var (explicit override)
//   2. .firebaserc  → projects.default  (the config file you set up at deploy time)
//
// So in a normal deployed checkout you can just run `npx tsx scripts/<name>.ts`
// with no env vars; set GCLOUD_PROJECT only to target a different project.
export function requireProjectId(): string {
  const fromEnv = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
  if (fromEnv) return fromEnv;

  const fromRc = readFirebaseRc();
  if (fromRc) return fromRc;

  console.error(
    "Missing project ID. Set it in .firebaserc (projects.default) — see .firebaserc.example — " +
      "or pass GCLOUD_PROJECT=<project-id>."
  );
  process.exit(1);
}

function readFirebaseRc(): string | null {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const rc = JSON.parse(readFileSync(join(root, ".firebaserc"), "utf8"));
    return rc?.projects?.default ?? null;
  } catch {
    return null;
  }
}
