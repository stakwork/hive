import { swarmApiRequest } from "@/services/swarm/api/swarm";

type Creds = { username?: string; pat?: string };

export interface AsyncSyncResult {
  ok: boolean;
  status: number;
  data?: { request_id?: string; [k: string]: unknown };
}

export async function triggerSync(
  swarmName: string,
  apiKey: string,
  repoUrl: string,
  creds?: Creds,
) {
  console.log("===Trigger Sync was hit");
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

//
export async function triggerAsyncSync(
  swarmHost: string,
  apiKey: string,
  repoUrl: string,
  creds?: Creds,
  callbackUrl?: string,
) {
  console.log("===Trigger AsyncSync was hit");
  const stakgraphUrl = `https://${swarmHost}:7799`;
  const data: Record<string, string> = { repo_url: repoUrl };
  if (creds?.username) data.username = creds.username;
  if (creds?.pat) data.pat = creds.pat;
  if (callbackUrl) (data as Record<string, string>).callback_url = callbackUrl;
  return swarmApiRequest({
    swarmUrl: stakgraphUrl,
    endpoint: "/sync_async",
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
  callbackUrl?: string,
) {
  console.log("===Trigger IngestAsync was hit");
  const stakgraphUrl = `https://${swarmName}:7799`;
  const data: Record<string, string> = {
    repo_url: repoUrl,
    username: creds.username,
    pat: creds.pat,
  };
  if (callbackUrl) data.callback_url = callbackUrl;
  return swarmApiRequest({
    swarmUrl: stakgraphUrl,
    endpoint: "/ingest_async",
    method: "POST",
    apiKey,
    data,
  });
}
