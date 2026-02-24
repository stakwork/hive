export function getStakworkTokenReference(): string {
  return process.env.VERCEL_ENV === "production"
    ? "{{HIVE_PROD}}"
    : "{{HIVE_STAGING}}";
}
