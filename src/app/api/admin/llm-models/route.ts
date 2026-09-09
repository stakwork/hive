import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { validateApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { LlmProvider, Prisma } from "@prisma/client";

/**
 * `name` and `providerLabel` are string-concatenated into the
 * `provider/name` value shipped as `vars.model` (see `getModelValue()`
 * in `src/lib/ai/models.ts`), and `getApiKeyForModel` derives the
 * credential from the *first* path segment. An unconstrained `name`
 * containing a `/` could make a row declared as one provider resolve
 * to a different provider's key (e.g. an `XAI` row named
 * "anthropic/claude-x"). No slashes, and only characters that make
 * sense in a model id / display label.
 *
 * `OTHER`/OpenRouter rows are the one exception: OpenRouter model ids
 * are themselves `vendor/model` (e.g. "stealth/ox-alpha"), and
 * `getModelValue()` prefixes them with `providerLabel/` (e.g.
 * "openrouter/stealth/ox-alpha"), so `name` needs to allow one or more
 * `/`-delimited safe segments there. First-class providers still
 * forbid `/` in `name` entirely, since `getApiKeyForModel` keys off
 * the first path segment.
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

export async function GET(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const models = await db.llmModel.findMany({
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.error("Error fetching LLM models:", error);
    return NextResponse.json(
      { error: "Failed to fetch LLM models" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const isSync = validateApiToken(request);
  if (!isSync) {
    const authResult = await requireSuperAdmin(request);
    if (authResult instanceof NextResponse) return authResult;
  }

  // Captured outside the try block so the P2002 handler can look up the
  // conflicting row without re-reading the request body (NextRequest
  // bodies can only be consumed once — `request.clone()` after the body
  // has already been read via `.json()` doesn't give a fresh stream).
  let singleCreateName: string | undefined;

  try {
    const body = await request.json();

    // Batch upsert path
    if (Array.isArray(body.models)) {
      const items = body.models;

      // Validate required fields
      for (const item of items) {
        if (!item.name || !item.provider || item.inputPricePer1M == null || item.outputPricePer1M == null) {
          return NextResponse.json(
            { error: "Each model requires: name, provider, inputPricePer1M, outputPricePer1M" },
            { status: 400 }
          );
        }
        const nameErr = validateNameFields(item.name, item.providerLabel, item.provider);
        if (nameErr) return nameErr;
      }

      const models = await Promise.all(
        items.map(({ name, provider, providerLabel, inputPricePer1M, outputPricePer1M, cacheReadPer1MToken, cacheWritePer1MToken }: {
          name: string;
          provider: LlmProvider;
          providerLabel?: string;
          inputPricePer1M: number;
          outputPricePer1M: number;
          cacheReadPer1MToken?: number | null;
          cacheWritePer1MToken?: number | null;
        }) =>
          db.llmModel.upsert({
            where: { name },
            create: {
              name,
              provider,
              providerLabel: providerLabel ?? null,
              inputPricePer1M: Number(inputPricePer1M),
              outputPricePer1M: Number(outputPricePer1M),
              cacheReadPer1MToken: cacheReadPer1MToken != null ? Number(cacheReadPer1MToken) : null,
              cacheWritePer1MToken: cacheWritePer1MToken != null ? Number(cacheWritePer1MToken) : null,
            },
            // `provider` / `providerLabel` are intentionally omitted here.
            // The nightly sync (src/lib/ai/llm-model-sync.ts, scheduled by
            // vercel.json) round-trips through this same batch-upsert path,
            // and its diff step normalizes providers to a coarse
            // OPENAI|ANTHROPIC|GOOGLE|AWS_BEDROCK|OTHER bucket — re-applying
            // that here would silently revert any row an admin has
            // reclassified (e.g. XAI) within a day. The sync owns pricing;
            // the admin UI is authoritative for provider classification.
            // Mirrors the existing deliberate omission of isPlanDefault /
            // isTaskDefault / isPublic / dateStart / dateEnd below.
            update: {
              inputPricePer1M: Number(inputPricePer1M),
              outputPricePer1M: Number(outputPricePer1M),
              cacheReadPer1MToken: cacheReadPer1MToken != null ? Number(cacheReadPer1MToken) : null,
              cacheWritePer1MToken: cacheWritePer1MToken != null ? Number(cacheWritePer1MToken) : null,
            },
          })
        )
      );

      return NextResponse.json({ models }, { status: 201 });
    }

    // Single model create path (existing behaviour)
    const { name, provider, providerLabel, inputPricePer1M, outputPricePer1M, cacheReadPer1MToken, cacheWritePer1MToken, dateStart, dateEnd, isPlanDefault, isTaskDefault, isPublic } = body;
    singleCreateName = name;

    if (!name || !provider || inputPricePer1M == null || outputPricePer1M == null) {
      return NextResponse.json(
        { error: "name, provider, inputPricePer1M, and outputPricePer1M are required" },
        { status: 400 }
      );
    }

    const nameErr = validateNameFields(name, providerLabel, provider);
    if (nameErr) return nameErr;

    // The default-flip (clear the existing default, then create the new
    // row as the default) must be atomic — a non-transactional
    // read-modify-write here can leave two defaults, or (on a mid-way
    // failure) zero, and `getDefaultModel` resolves via `findFirst`.
    const model = await db.$transaction(async (tx) => {
      if (isPlanDefault) {
        await tx.llmModel.updateMany({ where: { isPlanDefault: true }, data: { isPlanDefault: false } });
      }
      if (isTaskDefault) {
        await tx.llmModel.updateMany({ where: { isTaskDefault: true }, data: { isTaskDefault: false } });
      }

      return tx.llmModel.create({
        data: {
          name,
          provider,
          providerLabel: providerLabel ?? null,
          inputPricePer1M: Number(inputPricePer1M),
          outputPricePer1M: Number(outputPricePer1M),
          cacheReadPer1MToken: cacheReadPer1MToken != null ? Number(cacheReadPer1MToken) : null,
          cacheWritePer1MToken: cacheWritePer1MToken != null ? Number(cacheWritePer1MToken) : null,
          dateStart: dateStart ? new Date(dateStart) : null,
          dateEnd: dateEnd ? new Date(dateEnd) : null,
          isPlanDefault: isPlanDefault ?? false,
          isTaskDefault: isTaskDefault ?? false,
          isPublic: isPublic ?? false,
        },
      });
    });

    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    // `name` has a DB-level unique constraint — a duplicate throws
    // Prisma's P2002 rather than validating cleanly. Surface a 409 with
    // the existing row's id so the admin can PATCH it directly (e.g.
    // migrating a pre-existing `grok-*` row from OTHER/OpenRouter to
    // XAI) instead of hitting a raw 500. `singleCreateName` was captured
    // before the failed create — the request body stream has already
    // been consumed by `request.json()` above and can't be re-read.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = singleCreateName
        ? await db.llmModel.findUnique({ where: { name: singleCreateName }, select: { id: true } })
        : null;
      return NextResponse.json(
        {
          error: "A model with this name already exists",
          existingId: existing?.id,
        },
        { status: 409 },
      );
    }
    console.error("Error creating LLM model:", error);
    return NextResponse.json(
      { error: "Failed to create LLM model" },
      { status: 500 }
    );
  }
}
