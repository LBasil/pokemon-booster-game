// Everyone who signs up before the beta ends is a beta tester, for good.
// While it runs, BETA_END stays null (every account qualifies); when the
// game leaves beta, set it to that moment (ISO string) and only the
// accounts created before it keep the badge. Based on profiles.created_at.
export const BETA_END = null

/** Whether an account created at `createdAt` joined during the beta. */
export function isBetaTester(createdAt, betaEnd = BETA_END) {
  if (!createdAt) return false
  const joined = new Date(createdAt).getTime()
  if (Number.isNaN(joined)) return false
  return betaEnd == null || joined < new Date(betaEnd).getTime()
}
