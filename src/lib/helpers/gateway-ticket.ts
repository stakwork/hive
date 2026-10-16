import { EncryptionService } from "@/lib/encryption";
import { resolveOrgSwarmWorkspaceForUser } from "@/lib/helpers/org-workspace";
import { deriveBifrostBaseUrl } from "@/services/bifrost/resolve";
import { BIFROST_HTTP_TIMEOUT_MS } from "@/services/bifrost/constants";

export type MintGatewayTicketResult =
  | { ok: true; url: string; ticket: string }
  | { ok: false; error: string; status: number };

/**
 * Mints a short-lived single-use bootstrap ticket for the gateway plugin's
 * admin UI. Picks the org's default workspace when accessible, else the first
 * reachable one; authenticates with the swarm's `swarmApiKey`.
 */
export async function mintGatewayTicket(
  githubLogin: string,
  userId: string,
): Promise<MintGatewayTicketResult> {
  const workspace = await resolveOrgSwarmWorkspaceForUser(githubLogin, userId);

  if (!workspace || !workspace.swarm) {
    return { ok: false, error: "No swarm configured for any workspace in this org", status: 404 };
  }
  const { swarm } = workspace;
  if (!swarm.swarmUrl || !swarm.swarmApiKey) {
    return { ok: false, error: "Swarm is missing swarmUrl or swarmApiKey", status: 503 };
  }

  let provisioningToken: string;
  try {
    provisioningToken = EncryptionService.getInstance().decryptField("swarmApiKey", swarm.swarmApiKey);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to decrypt swarmApiKey: ${err instanceof Error ? err.message : String(err)}`,
      status: 500,
    };
  }

  const baseUrl = deriveBifrostBaseUrl(swarm.swarmUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BIFROST_HTTP_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/_plugin/auth/ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provisioningToken}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const msg =
      (err as Error).name === "AbortError"
        ? `gateway mint timed out after ${BIFROST_HTTP_TIMEOUT_MS}ms`
        : `gateway mint failed: ${err instanceof Error ? err.message : String(err)}`;
    return { ok: false, error: msg, status: 502 };
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return { ok: false, error: `gateway mint returned ${resp.status}: ${text.slice(0, 200)}`, status: 502 };
  }

  const body = (await resp.json()) as { ticket?: string };
  if (!body?.ticket) {
    return { ok: false, error: "gateway mint returned no ticket", status: 502 };
  }

  return { ok: true, url: baseUrl, ticket: body.ticket };
}
