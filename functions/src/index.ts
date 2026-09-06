import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onTransactionCreated, onTransactionUpdated, onTransactionDeleted } from "./transactionTrigger.js";
export { monthlyInterest } from "./monthlyCron.js";
export { changeRate } from "./rateChange.js";
export {
  needsSetup,
  bootstrapFirstAdmin,
  createUser,
  listUsers,
  setUserRole,
  deleteUser,
} from "./userAdmin.js";
export { weeklyBackup } from "./backup.js";
