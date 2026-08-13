import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { recomputeFromMonth, getMonthKeyFromTimestamp } from "./recompute.js";
import { writeSummary } from "./writeSummary.js";
import { Timestamp } from "firebase-admin/firestore";

const DOCUMENT_PATH = "accounts/{accountId}/transactions/{txId}";

export const onTransactionCreated = onDocumentCreated(DOCUMENT_PATH, async (event) => {
  const accountId = event.params.accountId;
  const data = event.data?.data();
  if (!data) return;

  const monthKey = getMonthKeyFromTimestamp(data.date as Timestamp);
  await recomputeFromMonth(accountId, monthKey);
  await writeSummary();
});

export const onTransactionUpdated = onDocumentUpdated(DOCUMENT_PATH, async (event) => {
  const accountId = event.params.accountId;
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  const beforeMonth = getMonthKeyFromTimestamp(before.date as Timestamp);
  const afterMonth = getMonthKeyFromTimestamp(after.date as Timestamp);
  const earliestMonth = beforeMonth < afterMonth ? beforeMonth : afterMonth;

  await recomputeFromMonth(accountId, earliestMonth);
  await writeSummary();
});

export const onTransactionDeleted = onDocumentDeleted(DOCUMENT_PATH, async (event) => {
  const accountId = event.params.accountId;
  const data = event.data?.data();
  if (!data) return;

  const monthKey = getMonthKeyFromTimestamp(data.date as Timestamp);
  await recomputeFromMonth(accountId, monthKey);
  await writeSummary();
});
