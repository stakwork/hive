import { describe, it, expect } from "vitest";
import { generateUniqueWorkspaceSlug } from "@/__tests__/support/helpers/ids";
import { updateWorkspaceSchema } from "@/lib/schemas/workspace";

/**
 * Fixture slugs are echoed back through the product's own validators by the
 * workspace API integration tests, so they have to satisfy the real rules.
 * The previous default overshot the 50-char cap ~2% of the time, which read
 * as an intermittent 400 in whichever PUT test drew the long slug.
 */
describe("generateUniqueWorkspaceSlug", () => {
  it("always produces a slug the product's own schema accepts", () => {
    const rejected: Array<{ slug: string; issue: string }> = [];

    for (let i = 0; i < 5000; i++) {
      const slug = generateUniqueWorkspaceSlug();
      const result = updateWorkspaceSchema.safeParse({
        name: "Fixture Workspace",
        slug,
        description: "x",
      });
      if (!result.success) {
        rejected.push({ slug, issue: result.error.issues[0].message });
      }
    }

    expect(rejected).toEqual([]);
  });

  it("stays unique across rapid successive calls", () => {
    const slugs = Array.from({ length: 2000 }, () =>
      generateUniqueWorkspaceSlug(),
    );
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
