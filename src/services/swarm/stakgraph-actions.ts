import { swarmApiRequest } from "@/services/swarm/api/swarm";

type Creds = { username?: string; pat?: string };

export interface AsyncSyncResult {
  ok: boolean;
  status: number;
  data?: { request_id?: string; [k: string]: unknown };
}

export async function triggerSync(swarmName: string, apiKey: string, repoUrl: string, creds?: Creds) {
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
): Promise<AsyncSyncResult> {
  console.log("===Trigger AsyncSync was hit");
  const stakgraphUrl = `https://${swarmHost}:7799`;
  const data: Record<string, string> = { repo_url: repoUrl };
  if (creds?.username) data.username = creds.username;
  if (creds?.pat) data.pat = creds.pat;
  if (callbackUrl) (data as Record<string, string>).callback_url = callbackUrl;
  const result = await swarmApiRequest({
    swarmUrl: stakgraphUrl,
    endpoint: "/sync_async",
    method: "POST",
    apiKey,
    data,
  });

  return {
    ok: result.ok,
    status: result.status,
    data: result.data as { request_id?: string; [k: string]: unknown } | undefined,
  };
}

export async function triggerIngestAsync(
  swarmName: string,
  apiKey: string,
  repoUrl: string,
  creds: { username: string; pat: string },
  callbackUrl?: string,
  useLsp: boolean = false,
) {
  console.log("===Trigger IngestAsync was hit. useLsp:", useLsp);
  const stakgraphUrl = `https://${swarmName}:7799`;
  const data: Record<string, string | boolean> = {
    repo_url: repoUrl,
    username: creds.username,
    pat: creds.pat,
    use_lsp: useLsp,
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
