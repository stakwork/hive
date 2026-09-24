import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveAuthorizedOrgId } from "@/lib/auth/org-access";
import { createOrgApiKey, listOrgApiKeys } from "@/lib/org-api-keys";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  expiresAt: z.string().datetime().nullish(),
});

/**
 * GET /api/orgs/[githubLogin]/api-keys
 * List the org's API keys (admin only; raw keys are never returned).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  try {
    return NextResponse.json({ keys: await listOrgApiKeys(orgId) });
  } catch (error) {
    console.error("[GET /api/orgs/[githubLogin]/api-keys]", error);
    return NextResponse.json({ error: "Failed to list API keys" }, { status: 500 });
  }
}

/**
 * POST /api/orgs/[githubLogin]/api-keys
 * Create an org API key (admin only). The raw `hiveorg_…` key is in the
 * response once and never again.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ githubLogin: string }> }) {
  const userOrResponse = requireAuth(getMiddlewareContext(request));
  if (userOrResponse instanceof NextResponse) return userOrResponse;

  const { githubLogin } = await params;
  const orgId = await resolveAuthorizedOrgId(githubLogin, userOrResponse.id, true);
  if (!orgId) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  let data: z.infer<typeof createSchema>;
  try {
    data = createSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", details: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) {
    return NextResponse.json({ error: "expiresAt must be in the future" }, { status: 400 });
  }

  try {
    const key = await createOrgApiKey({ orgId, name: data.name, createdById: userOrResponse.id, expiresAt });
    return NextResponse.json({ key }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/orgs/[githubLogin]/api-keys]", error);
    return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
  }
}
