import { tool, type ToolSet } from "ai";
import { z } from "zod";

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

async function clFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.COURTLISTENER_API_TOKEN?.trim();
  if (!token) throw new Error("COURTLISTENER_API_TOKEN is not configured");
  const url = path.startsWith("http") ? path : `${CL_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      Authorization: `Token ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429)
      throw new Error("CourtListener rate-limited — stop all CourtListener calls for this turn");
    throw new Error(`CourtListener ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function buildCourtlistenerTools(slug: string): ToolSet {
  return {
    [`${slug}__courtlistener_verify_citations`]: tool({
      description: `[${slug}] Verify legal citations against CourtListener. Accepts up to 250 citations, returns matched case links and results.`,
      inputSchema: z.object({
        citations: z.array(z.string()).describe("List of legal citations to verify"),
      }),
      execute: async ({ citations }: { citations: string[] }) => {
        try {
          const joined = citations.slice(0, 250).join("\n").slice(0, 64_000);
          const body = new URLSearchParams({ text: joined }).toString();
          const data = await clFetch<{
            citation_links?: Record<string, unknown>;
            results?: unknown[];
          }>("/citation-lookup/", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
          });
          return {
            citationsSubmitted: citations.slice(0, 250).length,
            citationLinks: data.citation_links ?? {},
            results: data.results ?? [],
          };
        } catch (e) {
          return `Could not verify citations: ${e}`;
        }
      },
    }),

    [`${slug}__courtlistener_search_case_law`]: tool({
      description: `[${slug}] Search CourtListener for case law opinions. Returns case metadata including clusterId, name, citation, court, date filed, snippet, and URL.`,
      inputSchema: z.object({
        query: z.string().describe("Search query for case law"),
        court: z.string().optional().describe("Filter by court identifier (e.g. 'scotus')"),
        filedAfter: z.string().optional().describe("Filter to cases filed after this date (YYYY-MM-DD)"),
        filedBefore: z.string().optional().describe("Filter to cases filed before this date (YYYY-MM-DD)"),
        limit: z.number().min(1).max(20).default(10).describe("Maximum number of results to return"),
      }),
      execute: async ({
        query,
        court,
        filedAfter,
        filedBefore,
        limit,
      }: {
        query: string;
        court?: string;
        filedAfter?: string;
        filedBefore?: string;
        limit: number;
      }) => {
        try {
          const params = new URLSearchParams({ type: "o", q: query });
          if (court) params.set("court", court);
          if (filedAfter) params.set("filed_after", filedAfter);
          if (filedBefore) params.set("filed_before", filedBefore);
          const data = await clFetch<{
            results?: Array<{
              cluster_id?: number;
              case_name?: string;
              citation?: string[];
              court?: string;
              date_filed?: string;
              snippet?: string;
              absolute_url?: string;
            }>;
          }>(`/search/?${params.toString()}`);
          const results = (data.results ?? []).slice(0, limit).map((r) => ({
            clusterId: r.cluster_id,
            caseName: r.case_name,
            citation: r.citation?.[0] ?? null,
            court: r.court,
            dateFiled: r.date_filed,
            snippet: r.snippet,
            url: r.absolute_url
              ? `https://www.courtlistener.com${r.absolute_url}`
              : null,
          }));
          return results;
        } catch (e) {
          return `Could not search case law: ${e}`;
        }
      },
    }),

    [`${slug}__courtlistener_get_cases`]: tool({
      description: `[${slug}] Fetch case metadata and opinion text from CourtListener by cluster ID. Fetches up to 10 clusters concurrently (first-page opinions only). Opinion text is truncated to maxChars across all clusters combined.`,
      inputSchema: z.object({
        clusterIds: z
          .array(z.number())
          .min(1)
          .max(10)
          .describe("List of CourtListener cluster IDs to fetch (max 10)"),
        includeFullText: z
          .boolean()
          .default(false)
          .describe("Whether to include opinion text in the response"),
        maxChars: z
          .number()
          .min(1000)
          .max(50000)
          .default(12000)
          .describe("Maximum total characters of opinion text across all cases"),
      }),
      execute: async ({
        clusterIds,
        includeFullText,
        maxChars,
      }: {
        clusterIds: number[];
        includeFullText: boolean;
        maxChars: number;
      }) => {
        try {
          let charsRemaining = maxChars;

          const cases = await Promise.all(
            clusterIds.map(async (clusterId) => {
              try {
                const [clusterData, opinionsData] = await Promise.all([
                  clFetch<{
                    case_name?: string;
                    citations?: Array<{ cite?: string }>;
                    date_filed?: string;
                    absolute_url?: string;
                  }>(`/clusters/${clusterId}/`),
                  clFetch<{
                    results?: Array<{
                      plain_text?: string;
                      html?: string;
                      type?: string;
                    }>;
                  }>(`/opinions/?cluster=${clusterId}`),
                ]);

                const opinions = (opinionsData.results ?? []).map((op) => {
                  let text = "";
                  if (includeFullText && charsRemaining > 0) {
                    const raw =
                      op.plain_text && op.plain_text.trim()
                        ? op.plain_text
                        : op.html
                          ? stripHtml(op.html)
                          : "";
                    if (raw) {
                      text = raw.slice(0, charsRemaining);
                      charsRemaining -= text.length;
                    }
                  }
                  return {
                    type: op.type,
                    ...(includeFullText ? { text } : {}),
                  };
                });

                return {
                  clusterId,
                  caseName: clusterData.case_name ?? null,
                  citation: clusterData.citations?.[0]?.cite ?? null,
                  dateFiled: clusterData.date_filed ?? null,
                  url: clusterData.absolute_url
                    ? `https://www.courtlistener.com${clusterData.absolute_url}`
                    : null,
                  opinions,
                };
              } catch (e) {
                return {
                  clusterId,
                  error: String(e),
                  caseName: null,
                  citation: null,
                  dateFiled: null,
                  url: null,
                  opinions: [],
                };
              }
            }),
          );

          return { cases };
        } catch (e) {
          return `Could not fetch cases: ${e}`;
        }
      },
    }),
  };
}
