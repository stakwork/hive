export function transformSwarmUrlToRepo2Graph(
  swarmUrl: string | null | undefined,
): string {
  if (!swarmUrl) return "";

  return swarmUrl.endsWith("/api")
    ? swarmUrl.replace("/api", ":3355")
    : swarmUrl + ":3355";
}
