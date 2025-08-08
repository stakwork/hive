import { swarmApiRequest } from "@/services/swarm/api/swarm";

type Creds = { username?: string; pat?: string };

export async function triggerSync(
  swarmName: string,
  apiKey: string,
  repoUrl: string,
  creds?: Creds,
) {
  const stakgraphUrl = `https://${swarmName}:7799`;
  const data: Record<string, string> = { repo_url: repoUrl };
  if (creds?.username) data.username = creds.username;
  if (creds?.pat) data.pat = creds.pat;
  return swarmApiRequest({
    swarmUrl: stakgraphUrl,
    endpoint: "/sync",
    method: "POST",
    apiKey,
    data,
  });
}

export async function triggerIngestAsync(
  swarmName: string,
  apiKey: string,
  repoUrl: string,
  creds: { username: string; pat: string },
) {
  const stakgraphUrl = `https://${swarmName}:7799`;
  const data = { repo_url: repoUrl, username: creds.username, pat: creds.pat };
  return swarmApiRequest({
    swarmUrl: stakgraphUrl,
    endpoint: "/ingest_async",
    method: "POST",
    apiKey,
    data,
  });
}
