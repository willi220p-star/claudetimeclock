import { clearOfficeClock, resetDatabase } from "./fixtures";

export default function globalSetup() {
  if (process.env.E2E_RESET === "1") resetDatabase();
  // A crashed run can leave the office clock frozen; start and finish on the real clock.
  clearOfficeClock();
  return clearOfficeClock;
}
