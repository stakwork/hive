/**
 * Strut delegation reconciler — the daily pass behind
 * `GET /api/cron/strut-delegations` (`strut/plans/mothership-cost-control.md`
 * §4.5).
 *
 * Desired state lives on `WorkspaceMember` (`strutDelegationExp`,
 * `strutDelegationId` — never the token); actual state is what each
 * workspace swarm's strut lists at `GET /llm/delegations`. Per Bifrost-
 * enabled workspace with a swarm:
 *
 *   - an ACTIVE member with a delegation on record (either side) whose
 *     entry is missing from strut, or within 15 days of its expiry, gets a
 *     fresh mint + `PUT` — so a wiped strut volume heals with nobody
 *     visiting, and the 60-day expiry is only ever a backstop;
 *   - a member who LEFT (`leftAt` set — leaving is a soft delete, and
 *     nothing else revokes Bifrost state) gets its delegation `DELETE`d and
 *     the two columns cleared;
 *   - a member who never had one is left alone: the first visit pushes it
 *     (`ensureStrutDelegation`), not the cron.
 *
 * Actors strut lists that hive does not know are never touched. Every
 * failure is recorded per workspace / actor and the pass continues.
 */

import { isBifrostEnabledForAgent, isBifrostEnabledForWorkspace } from "@/config/env";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { STRUT_DELEGATION_LOG_TAG, STRUT_DELEGATION_RENEW_WITHIN_MS } from "@/services/bifrost/constants";
import {
  STRUT_DELEGATION_AGENT,
  StrutDelegationsUnsupportedError,
  deleteStrutDelegation,
  isWithinRenewWindow,
  listStrutDelegations,
  pushStrutDelegation,
  strutLabBaseUrl,
  type StrutLabTarget,
} from "@/services/bifrost/strut-delegation";

export interface StrutDelegationReconcileError {
  workspaceSlug: string;
  actor?: string;
  error: string;
}

export interface StrutDelegationReconcileResult {
  success: boolean;
  /** Workspaces whose strut was read. */
  workspacesProcessed: number;
  /** Workspaces skipped: gate closed, no usable swarm, or no delegation routes. */
  workspacesSkipped: number;
  pushed: number;
  deleted: number;
  errors: StrutDelegationReconcileError[];
  timestamp: Date;
}

export interface StrutDelegationReconcileOptions {
  /** Injectable clock (tests). */
  now?: Date;
  /** Scope the pass to one workspace slug (debugging). */
  workspaceSlug?: string;
}

export async function runStrutDelegationReconcile(
  options: StrutDelegationReconcileOptions = {},
): Promise<StrutDelegationReconcileResult> {
  const now = options.now ?? new Date();
  const result: StrutDelegationReconcileResult = {
    success: true,
    workspacesProcessed: 0,
    workspacesSkipped: 0,
    pushed: 0,
    deleted: 0,
    errors: [],
    timestamp: now,
  };

  // The macaroon issuer needs a source-control org to sign with; a
  // workspace without one cannot have a delegation on either side.
  const workspaces = await db.workspace.findMany({
    where: {
      deleted: false,
      sourceControlOrgId: { not: null },
      swarm: { isNot: null },
      ...(options.workspaceSlug ? { slug: options.workspaceSlug } : {}),
    },
    select: {
      id: true,
      slug: true,
      swarm: { select: { swarmUrl: true, swarmApiKey: true } },
    },
  });

  const agentGateOpen = isBifrostEnabledForAgent(STRUT_DELEGATION_AGENT);
  const { buildBifrostName } = await import("@/services/bifrost/reconciler");
  const encryption = EncryptionService.getInstance();

  for (const ws of workspaces) {
    if (!agentGateOpen || !isBifrostEnabledForWorkspace(ws.slug) || !ws.swarm?.swarmUrl || !ws.swarm?.swarmApiKey) {
      result.workspacesSkipped++;
      continue;
    }

    let swarmApiKey: string;
    try {
      swarmApiKey = encryption.decryptField("swarmApiKey", ws.swarm.swarmApiKey);
    } catch (err) {
      result.errors.push({
        workspaceSlug: ws.slug,
        error: `swarmApiKey decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    const target: StrutLabTarget = {
      labBase: strutLabBaseUrl(ws.swarm.swarmUrl),
      swarmApiKey,
    };

    let listed;
    try {
      listed = await listStrutDelegations(target);
    } catch (err) {
      if (err instanceof StrutDelegationsUnsupportedError) {
        result.workspacesSkipped++;
        continue;
      }
      result.errors.push({
        workspaceSlug: ws.slug,
        error: `GET /llm/delegations failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    result.workspacesProcessed++;
    const byActor = new Map(listed.map((d) => [d.actor, d]));

    const members = await db.workspaceMember.findMany({
      where: { workspaceId: ws.id },
      select: {
        userId: true,
        leftAt: true,
        strutDelegationExp: true,
        strutDelegationId: true,
        user: { select: { githubAuth: { select: { githubUsername: true } } } },
      },
    });

    for (const member of members) {
      const actor = buildBifrostName(member.userId, member.user?.githubAuth?.githubUsername ?? null);
      const current = byActor.get(actor);
      const onRecord = member.strutDelegationId !== null;

      try {
        if (member.leftAt) {
          if (current) {
            await deleteStrutDelegation(target, actor);
            result.deleted++;
            logger.info("Deleted strut delegation of a departed member", STRUT_DELEGATION_LOG_TAG, {
              workspaceId: ws.id,
              userId: member.userId,
              actor,
              delegationId: current.delegationId,
            });
          }
          if (onRecord || member.strutDelegationExp) {
            await db.workspaceMember.updateMany({
              where: { workspaceId: ws.id, userId: member.userId },
              data: { strutDelegationExp: null, strutDelegationId: null },
            });
          }
          continue;
        }

        if (!current && !onRecord) continue;

        const exp = current ? current.exp : member.strutDelegationExp;
        const expiring = !current || !exp || isWithinRenewWindow(exp, STRUT_DELEGATION_RENEW_WITHIN_MS, now);
        if (expiring) {
          await pushStrutDelegation({
            workspaceId: ws.id,
            userId: member.userId,
            swarmUrl: ws.swarm.swarmUrl,
            target,
          });
          result.pushed++;
          continue;
        }

        // Live and not expiring — make sure the record matches strut.
        if (current && member.strutDelegationId !== current.delegationId) {
          await db.workspaceMember.updateMany({
            where: { workspaceId: ws.id, userId: member.userId },
            data: {
              strutDelegationExp: new Date(current.exp),
              strutDelegationId: current.delegationId,
            },
          });
        }
      } catch (err) {
        result.errors.push({
          workspaceSlug: ws.slug,
          actor,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  result.success = result.errors.length === 0;
  logger.info("Strut delegation reconcile finished", STRUT_DELEGATION_LOG_TAG, {
    workspacesProcessed: result.workspacesProcessed,
    workspacesSkipped: result.workspacesSkipped,
    pushed: result.pushed,
    deleted: result.deleted,
    errors: result.errors.length,
  });
  return result;
}
