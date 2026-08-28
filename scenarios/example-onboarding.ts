import type { CohortFilter, Scenario } from "../src/types.js";

/**
 * Example SURVEY scenario. Describe your app's flow as text; each persona reads
 * it and self-reports. Swap the system/task text for your real product to get a
 * first read on where different user types drop off.
 */
const scenario: Scenario = {
  id: "example-onboarding",
  env: "survey",
  system: `You are trying out a new mobile app called "Seedwise", a personal finance / savings app. You just downloaded it on your phone and opened it for the first time.`,
  task: `Walk through this first-run onboarding as you actually would:
1. A welcome screen with a "Get started" button.
2. A screen asking you to sign in with email or Apple.
3. Three screens explaining features (auto-savings, goals, insights) you must swipe through.
4. A screen asking to connect your bank account before you can see anything.
5. A screen asking permission for notifications.
Then you reach the home screen.

Decide at each step whether you continue or bail, and why. Your 'answer' should be either "completed onboarding" or "abandoned at step N".`,
};

/** Optional: restrict the cohort. Here, only lower-patience users. */
export const cohort: CohortFilter = (p) => p.attributes.patience !== "high";

/** Optional: break the report down by these attribute keys. */
export const segmentBy = ["techSavvy", "patience"];

export default scenario;
