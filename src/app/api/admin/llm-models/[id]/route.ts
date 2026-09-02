import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { validateApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * `name` and `providerLabel` are string-concatenated into the
 * `provider/name` value shipped as `vars.model` (see `getModelValue()`
 * in `src/lib/ai/models.ts`), and `getApiKeyForModel` derives the
 * credential from the *first* path segment. An unconstrained `name`
 * containing a `/` could make a row declared as one provider resolve
 * to a different provider's key.
 *
 * `OTHER`/OpenRouter rows are the one exception: OpenRouter model ids
 * are themselves `vendor/model` (e.g. "stealth/ox-alpha"), and
 * `getModelValue()` prefixes them with `providerLabel/` (e.g.
 * "openrouter/stealth/ox-alpha"), so `name` needs to allow one or more
 * `/`-delimited safe segments there. First-class providers still
 * forbid `/` in `name` entirely, since `getApiKeyForModel` keys off
 * the first path segment. Kept in sync with the sibling validator in
 * `../route.ts`.
 */
const SAFE_NAME_RE = /^[A-Za-z0-9._:-]+$/;
const SAFE_NAME_WITH_SLASHES_RE = /^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)*$/;

function validateNameFields(
  name: unknown,
  providerLabel: unknown,
  provider: unknown,
): NextResponse | null {
  const nameRe = provider === "OTHER" ? SAFE_NAME_WITH_SLASHES_RE : SAFE_NAME_RE;
  if (typeof name === "string" && !nameRe.test(name)) {
    return NextResponse.json(
      { error: "name must match ^[A-Za-z0-9._:-]+$ (no slashes)" },
      { status: 400 },
    );
  }
  if (
    typeof providerLabel === "string" &&
    providerLabel.length > 0 &&
    !SAFE_NAME_RE.test(providerLabel)
  ) {
    return NextResponse.json(
      { error: "providerLabel must match ^[A-Za-z0-9._:-]+$ (no slashes)" },
      { status: 400 },
    );
  }
  return null;
}

/**
 * Fields the shared static `API_TOKEN` (external sync services) may
 * write via this endpoint. `isPublic` / `isPlanDefault` /
 * `isTaskDefault` are deliberately excluded — they gate what users see
 * and which model gets selected by default across the whole product,
 * so a token-only caller flipping them would escalate the sync
 * credential into product-wide model and spend control. Those three
 * require an authenticated `SUPER_ADMIN` session (see the `isSync`
 * branch below).
 */
const TOKEN_ALLOWED_FIELDS = new Set([
  "name",
  "provider",
  "providerLabel",
  "inputPricePer1M",
  "outputPricePer1M",
  "cacheReadPer1MToken",
  "cacheWritePer1MToken",
  "dateStart",
  "dateEnd",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const isSync = validateApiToken(request);
  if (!isSync) {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
  }

  const { id } = await params;

  try {
    const existing = await db.llmModel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    const body = await request.json();

    if (isSync) {
      const disallowed = Object.keys(body).filter(
        (key) => !TOKEN_ALLOWED_FIELDS.has(key),
      );
      if (disallowed.length > 0) {
        return NextResponse.json(
          {
            error: `Token-authenticated requests cannot set: ${disallowed.join(", ")}. These require a SUPER_ADMIN session.`,
          },
          { status: 403 },
        );
      }
    }

    const { name, provider, providerLabel, inputPricePer1M, outputPricePer1M, cacheReadPer1MToken, cacheWritePer1MToken, dateStart, dateEnd, isPlanDefault, isTaskDefault, isPublic } = body;

    // `provider` isn't always resent on a partial PATCH (e.g. renaming an
    // OpenRouter model's `name`) — fall back to the existing row's
    // provider so slash-containing OTHER names keep validating correctly
    // without requiring the caller to also resend `provider`.
    const effectiveProvider = provider !== undefined ? provider : existing.provider;
    const nameErr = validateNameFields(name, providerLabel, effectiveProvider);
    if (nameErr) return nameErr;

    // Atomic: clearing the existing default and applying this row's
    // update must happen together, or a mid-way failure can leave two
    // defaults (or zero) — `getDefaultModel` resolves via `findFirst`.
    const model = await db.$transaction(async (tx) => {
      if (isPlanDefault) {
        await tx.llmModel.updateMany({ where: { isPlanDefault: true, id: { not: id } }, data: { isPlanDefault: false } });
      }
      if (isTaskDefault) {
        await tx.llmModel.updateMany({ where: { isTaskDefault: true, id: { not: id } }, data: { isTaskDefault: false } });
      }

      return tx.llmModel.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(provider !== undefined && { provider }),
          ...(providerLabel !== undefined && { providerLabel }),
          ...(inputPricePer1M !== undefined && { inputPricePer1M: Number(inputPricePer1M) }),
          ...(outputPricePer1M !== undefined && { outputPricePer1M: Number(outputPricePer1M) }),
          ...(cacheReadPer1MToken !== undefined && { cacheReadPer1MToken: cacheReadPer1MToken != null ? Number(cacheReadPer1MToken) : null }),
          ...(cacheWritePer1MToken !== undefined && { cacheWritePer1MToken: cacheWritePer1MToken != null ? Number(cacheWritePer1MToken) : null }),
          ...(dateStart !== undefined && { dateStart: dateStart ? new Date(dateStart) : null }),
          ...(dateEnd !== undefined && { dateEnd: dateEnd ? new Date(dateEnd) : null }),
          ...(isPlanDefault !== undefined && { isPlanDefault }),
          ...(isTaskDefault !== undefined && { isTaskDefault }),
          ...(isPublic !== undefined && { isPublic }),
        },
      });
    });

    return NextResponse.json({ model });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A model with this name already exists" },
        { status: 409 },
      );
    }
    console.error("Error updating LLM model:", error);
    return NextResponse.json(
      { error: "Failed to update LLM model" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const { id } = await params;

  try {
    const existing = await db.llmModel.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    await db.llmModel.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting LLM model:", error);
    return NextResponse.json(
      { error: "Failed to delete LLM model" },
      { status: 500 }
    );
  }
}
