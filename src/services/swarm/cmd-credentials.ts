import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { isEncryptedEnvelope } from "./host-storage-read";

/**
 * Resolve the DB-stored swarm login credentials for an EC2 instance.
 *
 * This is the primary credential source for the admin swarm `cmd` endpoint —
 * the super-admin API (`fetchSwarmCredentials`) is only a fallback when this
 * returns `null`. Every "no usable credential" condition below returns `null`
 * rather than throwing, so the caller can uniformly fall back: zero matches,
 * more than one match (ambiguous — deliberately not an error here, since a
 * legitimate fallback exists, unlike `readHostStorage`'s distinct AMBIGUOUS
 * outcome), a deleted workspace, a missing `swarmUrl`/`swarmPassword`, a
 * non-envelope stored password, or a decrypt failure.
 *
 * The returned `swarmUrl` always comes from the matched DB row — never from
 * caller input.
 */

const encryptionService = EncryptionService.getInstance();

const LOG_PREFIX = "[SwarmCmdCredentials]";

export interface DbSwarmCredentials {
  swarmUrl: string;
  username: "admin";
  password: string;
}

/** Machine-readable reason a DB credential could not be resolved, for the
 * caller's own boundary logging — the return value stays a plain `null` per
 * the public contract, but the specific cause is still surfaced here. */
export type DbSwarmCredentialsFailureReason =
  | "no-db-record"
  | "ambiguous-db-record"
  | "workspace-deleted"
  | "no-db-password"
  | "decrypt-failed";

function logSkip(instanceId: string, reason: DbSwarmCredentialsFailureReason): null {
  console.warn(`${LOG_PREFIX} no usable credential instance=${instanceId} reason=${reason}`);
  return null;
}

export async function resolveDbSwarmCredentials(instanceId: string): Promise<DbSwarmCredentials | null> {
  const swarms = await db.swarm.findMany({
    where: { ec2Id: instanceId },
    select: {
      swarmUrl: true,
      swarmPassword: true,
      workspace: { select: { deleted: true } },
    },
  });

  if (swarms.length === 0) {
    return logSkip(instanceId, "no-db-record");
  }
  if (swarms.length > 1) {
    // Ambiguous — never silently pick a row. Deliberately diverges from
    // `readHostStorage`'s AMBIGUOUS outcome since this path has a legitimate
    // fallback (the super-admin API).
    return logSkip(instanceId, "ambiguous-db-record");
  }

  const swarm = swarms[0];

  if (swarm.workspace?.deleted) {
    return logSkip(instanceId, "workspace-deleted");
  }

  if (!swarm.swarmUrl || !swarm.swarmPassword) {
    return logSkip(instanceId, "no-db-password");
  }

  if (!isEncryptedEnvelope(swarm.swarmPassword)) {
    return logSkip(instanceId, "no-db-password");
  }

  let password: string;
  try {
    password = encryptionService.decryptField("swarmPassword", swarm.swarmPassword);
  } catch {
    return logSkip(instanceId, "decrypt-failed");
  }

  return { swarmUrl: swarm.swarmUrl, username: "admin", password };
}
