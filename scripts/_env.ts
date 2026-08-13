// Resolve the target Firebase project ID for admin scripts.
// Set it via the GCLOUD_PROJECT env var, e.g.:
//   GCLOUD_PROJECT=your-project-id npx tsx scripts/set-claims.ts user@example.com admin
export function requireProjectId(): string {
  const id = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
  if (!id) {
    console.error(
      "Missing project ID. Set GCLOUD_PROJECT to your Firebase project ID before running this script."
    );
    process.exit(1);
  }
  return id;
}
