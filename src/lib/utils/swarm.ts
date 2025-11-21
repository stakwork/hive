export function transformSwarmUrlToRepo2Graph(swarmUrl: string | null | undefined): string {
  if (!swarmUrl) return "";

  return swarmUrl.endsWith("/api") ? swarmUrl.replace("/api", ":3355") : swarmUrl + ":3355";
}

export function getJarvisUrl(swarmName: string): string {
  return `https://${swarmName}.sphinx.chat:8444`;
}
