/**
 * `canvas` realm resolver — fetches an authored node from a Canvas blob.
 *
 * Read-only; never mutates the blob.
 */

import { db } from "@/lib/db";
import type { CanvasNode } from "system-canvas";
import { asBlob } from "@/lib/canvas/io";
import { parseUrn, parseCanvasId } from "../parse";

export async function resolveCanvasNode(
  urn: string
): Promise<CanvasNode | null> {
  const parsed = parseUrn(urn);
  if (!parsed || parsed.realm !== "canvas") return null;

  const canvasId = parseCanvasId(parsed.id);
  if (!canvasId) return null;
  const { ref, nodeId } = canvasId;

  const org = await db.sourceControlOrg.findUnique({
    where: { githubLogin: parsed.org },
    select: { id: true },
  });
  if (!org) return null;

  const row = await db.canvas.findUnique({
    where: { orgId_ref: { orgId: org.id, ref } },
  });
  if (!row) return null;

  const blob = asBlob(row.data);
  return blob.nodes.find((n) => n.id === nodeId) ?? null;
}
