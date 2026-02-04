import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { getStakgraphUrl } from "@/lib/utils/stakgraph-url";

type Creds = { username?: string; pat?: string };

export interface SyncOptions {
  docs?: boolean | string;   // true = all repos (converted to "true"), string = comma-separated repo names
  mocks?: boolean | string;  // true = all repos (converted to "true"), string = comma-separated repo names
}

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
  useLsp: boolean = false,
) {
  console.log("===Trigger Sync was hit");
  const stakgraphUrl = getStakgraphUrl(swarmName);
  const data: Record<string, string | boolean> = { repo_url: repoUrl, use_lsp: useLsp };
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
  useLsp: boolean = false,
  options?: SyncOptions,
): Promise<AsyncSyncResult> {
  console.log("===Trigger AsyncSync was hit");
  const stakgraphUrl = getStakgraphUrl(swarmHost);
  const data: Record<string, string | boolean> = { repo_url: repoUrl, use_lsp: useLsp };
  if (creds?.username) data.username = creds.username;
  if (creds?.pat) data.pat = creds.pat;
  if (callbackUrl) (data as Record<string, string>).callback_url = callbackUrl;
  // API expects strings, not booleans - convert true to "true"
  if (options?.docs) data.docs = options.docs === true ? "true" : options.docs;
  if (options?.mocks) data.mocks = options.mocks === true ? "true" : options.mocks;
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
  options?: SyncOptions,
) {
  console.log("===Trigger IngestAsync was hit. useLsp:", useLsp);
  const stakgraphUrl = getStakgraphUrl(swarmName);
  const data: Record<string, string | boolean> = {
    repo_url: repoUrl,
    username: creds.username,
    pat: creds.pat,
    use_lsp: useLsp,
    realtime: true,
  };
  if (callbackUrl) data.callback_url = callbackUrl;
  // API expects strings, not booleans - convert true to "true"
  if (options?.docs) data.docs = options.docs === true ? "true" : options.docs;
  if (options?.mocks) data.mocks = options.mocks === true ? "true" : options.mocks;
  return swarmApiRequest({
    swarmUrl: stakgraphUrl,
    endpoint: "/ingest_async",
    method: "POST",
    apiKey,
    data,
  });
}
