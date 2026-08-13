import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash } from "crypto";

// Dedicated backups bucket. Defaults to "<project-id>-backups"; override with
// the BACKUP_BUCKET env var (set in functions config) if you use another name.
const BUCKET_NAME = process.env.BACKUP_BUCKET || `${process.env.GCLOUD_PROJECT}-backups`;
const MAX_SNAPSHOTS = 52;

async function exportAllData(): Promise<string> {
  const db = getFirestore();

  const accountsSnap = await db.collection("accounts").get();
  const accounts: Record<string, any> = {};

  for (const accountDoc of accountsSnap.docs) {
    const txSnap = await accountDoc.ref.collection("transactions").orderBy("date", "asc").get();
    const monthlySnap = await accountDoc.ref.collection("monthly").orderBy("__name__").get();

    accounts[accountDoc.id] = {
      ...accountDoc.data(),
      transactions: txSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      monthly: monthlySnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    };
  }

  const settingsSnap = await db.collection("settings").get();
  const settings: Record<string, any> = {};
  settingsSnap.forEach((d) => { settings[d.id] = d.data(); });

  const data = { accounts, settings };
  return JSON.stringify(data, Object.keys(data).sort(), 2);
}

export const weeklyBackup = onSchedule("0 0 * * 0", async () => {
  const bucket = getStorage().bucket(BUCKET_NAME);
  const json = await exportAllData();
  const hash = createHash("sha256").update(json).digest("hex");

  const hashFile = bucket.file("latest-hash.txt");
  const [hashExists] = await hashFile.exists();
  if (hashExists) {
    const [contents] = await hashFile.download();
    if (contents.toString().trim() === hash) return;
  }

  const dateKey = new Date().toISOString().slice(0, 10);
  const snapshotFile = bucket.file(`snapshots/${dateKey}.json`);
  await snapshotFile.save(json, { contentType: "application/json" });
  await hashFile.save(hash, { contentType: "text/plain" });

  // Prune old snapshots beyond MAX_SNAPSHOTS
  const [files] = await bucket.getFiles({ prefix: "snapshots/" });
  if (files.length > MAX_SNAPSHOTS) {
    const sorted = files.sort((a, b) => a.name.localeCompare(b.name));
    const toDelete = sorted.slice(0, files.length - MAX_SNAPSHOTS);
    for (const file of toDelete) {
      await file.delete();
    }
  }
});
