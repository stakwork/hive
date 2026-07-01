/**
 * Seedery for importing global Stakwork prompts into Hive.
 *
 * This module is consumed by:
 *   - `scripts/seed-stakwork-prompts.ts`  (CLI entry-point / deploy step)
 *   - Integration tests (import `seedPrompts` directly, mock fetch)
 *
 * It has no dependency on Next.js / App Router — only Prisma + fetch.
 */

import { PrismaClient } from "@prisma/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StakworkPromptListEntry {
  id: number;
  name: string;
  description?: string | null;
}

export interface StakworkPromptListPage {
  data: {
    total: number;
    size: number;
    prompts: StakworkPromptListEntry[];
  };
}

export interface StakworkPromptDetail {
  id: number;
  name: string;
  value: string;
  description?: string | null;
}

export interface StakworkPromptDetailResponse {
  data: StakworkPromptDetail;
}

export interface SeedResult {
  pagesFetched: number;
  totalSeen: number;
  totalCreated: number;
  totalSkipped: number;
  totalErrors: number;
}

export interface SeedConfig {
  /** Base URL without trailing /api/v1 */
  baseUrl: string;
  apiKey: string;
  /** Prisma client to use — callers pass their own so tests can share the test DB */
  prisma: PrismaClient;
  /** Page size Stakwork uses (Pagy default 20; injectable for tests) */
  pageSize?: number;
  /** Optional logger — defaults to console */
  log?: (message: string) => void;
}

// ── Stakwork HTTP helpers ─────────────────────────────────────────────────────

async function fetchListPage(
  baseUrl: string,
  apiKey: string,
  page: number
): Promise<StakworkPromptListPage> {
  const url = `${baseUrl}/api/v1/prompts?page=${page}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Token token="${apiKey}"`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`GET ${url} returned ${res.status}: ${await res.text()}`);
  }

  return res.json() as Promise<StakworkPromptListPage>;
}

async function fetchDetail(
  baseUrl: string,
  apiKey: string,
  id: number
): Promise<StakworkPromptDetail> {
  const url = `${baseUrl}/api/v1/prompts/${id}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Token token="${apiKey}"`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`GET ${url} returned ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as StakworkPromptDetailResponse;
  return body.data;
}

// ── Core seeder ───────────────────────────────────────────────────────────────

async function persistPrompt(
  prisma: PrismaClient,
  detail: StakworkPromptDetail
): Promise<"created" | "skipped"> {
  const { name, value, description, id: stakworkId } = detail;
  const safeValue = value ?? "";

  // Idempotent: skip if the name already exists in Hive
  const existing = await prisma.prompt.findUnique({ where: { name } });
  if (existing) {
    return "skipped";
  }

  const now = new Date();

  // Single transaction: Prompt → PromptVersion → update publishedVersionId
  await prisma.$transaction(async (tx) => {
    const prompt = await tx.prompt.create({
      data: {
        name,
        value: safeValue,
        description: description ?? null,
        stakworkId,
        syncStatus: "OK",
        lastSyncedAt: now,
      },
    });

    const version = await tx.promptVersion.create({
      data: {
        promptId: prompt.id,
        versionNumber: 1,
        value: safeValue,
        description: description ?? null,
        published: true,
        whodunnit: "stakwork-seed",
      },
    });

    await tx.prompt.update({
      where: { id: prompt.id },
      data: { publishedVersionId: version.id },
    });
  });

  return "created";
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Import all global Stakwork prompts into Hive's shared Prompt table.
 *
 * Idempotent — prompts that already exist (matched by name) are skipped.
 * Per-prompt failures are caught and counted; the seed continues past them.
 */
export async function seedPrompts(config?: Partial<SeedConfig>): Promise<SeedResult> {
  const baseUrl =
    config?.baseUrl ??
    (process.env.STAKWORK_BASE_URL?.replace(/\/api\/v1$/, "") ||
      "https://api.stakwork.com");

  const apiKey = config?.apiKey ?? process.env.STAKWORK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "STAKWORK_API_KEY is required for seeding prompts. " +
        "Set the environment variable or pass it via config."
    );
  }

  const prisma = config?.prisma ?? new PrismaClient();
  const PAGE_SIZE = config?.pageSize ?? 20;
  const log = config?.log ?? ((msg: string) => console.log(msg));

  const result: SeedResult = {
    pagesFetched: 0,
    totalSeen: 0,
    totalCreated: 0,
    totalSkipped: 0,
    totalErrors: 0,
  };

  log(`[seed:prompts] Starting — baseUrl=${baseUrl}`);

  let page = 1;

  while (true) {
    let listPage: StakworkPromptListPage;
    try {
      listPage = await fetchListPage(baseUrl, apiKey, page);
    } catch (err) {
      log(`[seed:prompts] Failed to fetch page ${page}: ${err}`);
      break;
    }

    const prompts = listPage.data?.prompts ?? [];
    result.pagesFetched++;
    result.totalSeen += prompts.length;

    log(
      `[seed:prompts] Page ${page}: ${prompts.length} prompts (total seen: ${result.totalSeen})`
    );

    for (const entry of prompts) {
      let detail: StakworkPromptDetail;
      try {
        detail = await fetchDetail(baseUrl, apiKey, entry.id);
      } catch (err) {
        log(
          `[seed:prompts] Failed to fetch detail for prompt id=${entry.id} name="${entry.name}": ${err}`
        );
        result.totalErrors++;
        continue;
      }

      try {
        const outcome = await persistPrompt(prisma, detail);
        if (outcome === "created") {
          result.totalCreated++;
          log(`[seed:prompts] Created: "${detail.name}" (stakworkId=${detail.id})`);
        } else {
          result.totalSkipped++;
          log(`[seed:prompts] Skipped (exists): "${detail.name}"`);
        }
      } catch (err) {
        log(
          `[seed:prompts] Failed to persist prompt "${detail.name}" (stakworkId=${detail.id}): ${err}`
        );
        result.totalErrors++;
      }
    }

    // Pagy: stop when fewer entries than the page size were returned
    if (prompts.length < PAGE_SIZE) {
      break;
    }

    page++;
  }

  log(
    `[seed:prompts] Done — pages: ${result.pagesFetched}, seen: ${result.totalSeen}, ` +
      `created: ${result.totalCreated}, skipped: ${result.totalSkipped}, errors: ${result.totalErrors}`
  );

  return result;
}
