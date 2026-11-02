import { describe, expect, it } from "vitest";
import { type FocusCandidate, closeNames, resolveFocus } from "@/lib/canvas/focus-target";

const C: FocusCandidate[] = [
  { kind: "component", ref: "c-auth", name: "auth service", view: "system" },
  { kind: "component", ref: "c-hive", name: "hive", view: "system" },
  { kind: "zone", ref: "zone:internal", name: "internal", view: "system" },
  { kind: "feature", ref: "f-repo", name: "Repo picker", view: "plan" },
  { kind: "feature", ref: "f-auth", name: "GitHub auth flow", view: "plan" },
  { kind: "initiative", ref: "i-onb", name: "Self-serve onboarding", view: "plan" },
];

describe("resolveFocus", () => {
  it("prefers an exact name over a contained one", () => {
    expect(resolveFocus(C, "hive")?.ref).toBe("c-hive");
  });

  it("finds a name containing the words, ignoring a kind word and a leading article", () => {
    expect(resolveFocus(C, "the auth component")?.ref).toBe("c-auth");
    expect(resolveFocus(C, "repo picker feature")).toMatchObject({ kind: "feature", ref: "f-repo", name: "Repo picker" });
  });

  it("is case-insensitive and drops trailing punctuation", () => {
    expect(resolveFocus(C, "REPO PICKER.")?.ref).toBe("f-repo");
  });

  it("goes to the bigger thing on a tie, and to the preferred view when equal", () => {
    expect(resolveFocus(C, "onboarding")?.kind).toBe("initiative");
    const twin: FocusCandidate[] = [
      { kind: "feature", ref: "a", name: "Sign in", view: "plan" },
      { kind: "feature", ref: "b", name: "Sign in", view: "system" },
    ];
    expect(resolveFocus(twin, "sign in", "system")?.ref).toBe("b");
  });

  it("says nothing when nothing matches, and suggests close names", () => {
    expect(resolveFocus(C, "payments")).toBeUndefined();
    expect(resolveFocus(C, "")).toBeUndefined();
    expect(closeNames(C, "authentication")).toEqual(expect.arrayContaining(["auth service"]));
    expect(closeNames(C, "zzz")).toEqual([]);
  });
});
