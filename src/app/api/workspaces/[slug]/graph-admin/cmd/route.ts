import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { getSwarmCmdJwt, swarmCmdRequest, SwarmCmd } from "@/services/swarm/cmd";
import QRCode from "qrcode";

export const runtime = "nodejs";

const ALLOWED_CMDS = new Set([
  "GetBoltwallAccessibility",
  "UpdateBoltwallAccessibility",
  "ListPaidEndpoint",
  "UpdatePaidEndpoint",
  "UpdateEndpointPrice",
  "GetBotBalance",
  "CreateBotInvoice",
  "GetEnrichedBoltwallUsers",
  "AddBoltwallAdminPubkey",
  "AddBoltwallUser",
  "ListAdmins",
  "DeleteSubAdmin",
  "UpdateUser",
]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // 1. Auth
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const access = await validateWorkspaceAccess(slug, userId, true);
  if (!access.hasAccess) {
    return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
  }
  if (!access.canAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // 2. Guard: graph_mindset only
  const workspaceId = access.workspace?.id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { workspaceKind: true },
  });
  if (workspace?.workspaceKind !== "graph_mindset") {
    return NextResponse.json({ error: "Not a GraphMindset workspace" }, { status: 403 });
  }

  // 3. Parse cmd from body
  const body = await request.json();
  const { cmd } = body as { cmd?: SwarmCmd };
  if (!cmd) {
    return NextResponse.json({ error: "Missing cmd" }, { status: 400 });
  }

  // Validate cmd is one of the allowed graph-admin variants
  const cmdName = (cmd as { type?: string; data?: { cmd?: string } }).data?.cmd;
  if (!cmdName || !ALLOWED_CMDS.has(cmdName)) {
    return NextResponse.json(
      { error: `Invalid cmd: must be one of ${[...ALLOWED_CMDS].join(", ")}` },
      { status: 400 },
    );
  }

  // 4. Resolve swarm URL + password
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: { swarmUrl: true, swarmPassword: true },
  });
  if (!swarm?.swarmUrl) {
    return NextResponse.json({ error: "Swarm not configured" }, { status: 404 });
  }

  // 5. Guard: swarmPassword must be set
  if (!swarm.swarmPassword) {
    return NextResponse.json({ error: "Swarm password not configured" }, { status: 502 });
  }

  // 6. Decrypt + authenticate
  const encryptionService = EncryptionService.getInstance();
  let password: string;
  try {
    password = encryptionService.decryptField("swarmPassword", swarm.swarmPassword);
  } catch {
    return NextResponse.json({ error: "Failed to decrypt swarm password" }, { status: 500 });
  }

  let jwt: string;
  try {
    jwt = await getSwarmCmdJwt(swarm.swarmUrl, password);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Swarm login failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 7. Intercept composite command: GetEnrichedBoltwallUsers
  if (cmdName === "GetEnrichedBoltwallUsers") {
    const [adminsResult, superAdminResult] = await Promise.allSettled([
      swarmCmdRequest({ swarmUrl: swarm.swarmUrl, jwt, cmd: { type: "Swarm", data: { cmd: "ListAdmins" } } }),
      swarmCmdRequest({ swarmUrl: swarm.swarmUrl, jwt, cmd: { type: "Swarm", data: { cmd: "GetBoltwallSuperAdmin" } } }),
    ]);

    const admins: Array<{ id: number; pubkey: string; name: string; role: string }> =
      adminsResult.status === "fulfilled" && adminsResult.value.ok
        ? (() => {
            const raw = adminsResult.value.data as { data?: { admins?: unknown[] }; admins?: unknown[] };
            return (raw?.data?.admins ?? raw?.admins ?? []) as Array<{ id: number; pubkey: string; name: string; role: string }>;
          })()
        : [];

    const superAdminInner =
      superAdminResult.status === "fulfilled" && superAdminResult.value.ok
        ? (superAdminResult.value.data as { data?: { pubkey?: string; name?: string } })?.data
        : undefined;
    const superAdmin: { pubkey: string; name: string } | null =
      superAdminInner?.pubkey ? (superAdminInner as { pubkey: string; name: string }) : null;

    // Build pubkey → Hive identity map using direct db.user queries

    // Part 1: Owner — fetch directly by ownerId (already in scope via access.workspace)
    const ownerUserId = access.workspace?.ownerId;
    const ownerUser = ownerUserId
      ? await db.user.findUnique({
          where: { id: ownerUserId },
          select: { name: true, image: true, lightningPubkey: true },
        })
      : null;

    // Part 2: Admins/members — scan db.user by lightningPubkey
    const adminPubkeys = admins.map((a) => a.pubkey);
    const usersWithPubkey =
      adminPubkeys.length > 0
        ? await db.user.findMany({
            where: { lightningPubkey: { not: null } },
            select: { name: true, image: true, lightningPubkey: true },
          })
        : [];

    const hiveMap = new Map<string, { name: string | null; image: string | null }>();

    // Owner: try to match their stored lightningPubkey to the boltwall superAdmin pubkey
    const superAdminPubkey = superAdmin?.pubkey ?? null;
    if (ownerUser?.lightningPubkey && superAdminPubkey) {
      try {
        const decrypted = encryptionService.decryptField("lightningPubkey", ownerUser.lightningPubkey);
        if (decrypted === superAdminPubkey) {
          hiveMap.set(superAdminPubkey, { name: ownerUser.name ?? null, image: ownerUser.image ?? null });
        }
      } catch {
        // skip if pubkey cannot be decrypted
      }
    }

    // Admins: decrypt and match against boltwall pubkeys
    for (const user of usersWithPubkey) {
      try {
        const decrypted = encryptionService.decryptField("lightningPubkey", user.lightningPubkey!);
        if (adminPubkeys.includes(decrypted)) {
          hiveMap.set(decrypted, { name: user.name ?? null, image: user.image ?? null });
        }
      } catch {
        // skip users whose pubkey cannot be decrypted
      }
    }

    // Build enriched list: owner first, then admins/members (deduplicating super admin)
    const ownerEntry = {
      pubkey: superAdminPubkey,
      name: superAdmin?.name ?? null,
      role: "owner" as const,
      hive: superAdminPubkey
        ? (hiveMap.get(superAdminPubkey) ?? null)
        : ownerUser
          ? { name: ownerUser.name ?? null, image: ownerUser.image ?? null }
          : null,
    };

    const enrichedAdmins = admins
      .filter((a) => a.pubkey !== superAdminPubkey)
      .map((a) => ({
        id: a.id,
        pubkey: a.pubkey,
        name: a.name,
        role: a.role,
        hive: hiveMap.get(a.pubkey) ?? null,
      }));

    return NextResponse.json({ users: [ownerEntry, ...enrichedAdmins] });
  }

  // 8. Proxy cmd to swarm
  const result = await swarmCmdRequest({ swarmUrl: swarm.swarmUrl, jwt, cmd });
  if (!result.ok) {
    return NextResponse.json(
      { error: "Swarm cmd failed", status: result.status, swarm: result.data ?? result.rawText },
      { status: 502 },
    );
  }

  // 9. Post-process CreateBotInvoice: append QR code
  if (cmdName === "CreateBotInvoice") {
    const inner = (result.data as { data?: { bolt11?: string } })?.data;
    const bolt11 = inner?.bolt11;
    if (bolt11) {
      const qrCodeDataUrl = await QRCode.toDataURL(bolt11, {
        errorCorrectionLevel: "M",
        type: "image/png",
        width: 300,
        margin: 2,
      });
      return NextResponse.json({ bolt11, qrCodeDataUrl });
    }
  }

  return NextResponse.json(result.data ?? result.rawText);
}
