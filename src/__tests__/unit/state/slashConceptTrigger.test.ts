/**
 * Unit tests for `detectSlashTrigger` / `insertSlashConcept` — the "/"
 * concept-mention trigger parser used by SidebarChat's composer.
 */

import { describe, it, expect } from "vitest";
import { detectSlashTrigger, insertSlashConcept } from "@/app/org/[githubLogin]/_state/slashConceptTrigger";

describe("detectSlashTrigger", () => {
  it("detects '/' at the very start of the text", () => {
    const trigger = detectSlashTrigger("/found", 6);
    expect(trigger).toEqual({ start: 0, query: "found" });
  });

  it("detects '/' right after a space", () => {
    const text = "hello /found";
    const trigger = detectSlashTrigger(text, text.length);
    expect(trigger).toEqual({ start: 6, query: "found" });
  });

  it("returns an empty query when the caret sits right after the '/'", () => {
    const trigger = detectSlashTrigger("/", 1);
    expect(trigger).toEqual({ start: 0, query: "" });
  });

  it("stops matching once whitespace appears after the '/'", () => {
    const text = "/found operator mindset";
    // caret right after "found " — a space has been typed, closing the query
    const trigger = detectSlashTrigger(text, 7);
    expect(trigger).toBeNull();
  });

  it("does not trigger on a '/' in the middle of a URL", () => {
    const text = "check https://example.com";
    const trigger = detectSlashTrigger(text, text.length);
    expect(trigger).toBeNull();
  });

  it("does not trigger on a '/' in the middle of a path-like word", () => {
    const text = "open /usr/bin for me";
    // caret right after "/usr/bin" — the second slash isn't at a word start
    const trigger = detectSlashTrigger(text, "open /usr/bin".length);
    // The first slash IS at a word start (preceded by a space), so this is
    // still a valid trigger — the whole "/usr/bin" is the query. What must
    // NOT happen is matching starting from the second "/".
    expect(trigger).toEqual({ start: 5, query: "usr/bin" });
  });

  it("does not trigger when the caret is mid-word after a non-whitespace char", () => {
    const text = "a/b";
    const trigger = detectSlashTrigger(text, text.length);
    expect(trigger).toBeNull();
  });

  it("re-triggers after the caret moves back into an earlier '/word'", () => {
    const text = "/Founder-Operator Mindset is key";
    const trigger = detectSlashTrigger(text, "/Founder-Operator".length);
    expect(trigger).toEqual({ start: 0, query: "Founder-Operator" });
  });

  it("returns null when there is no '/' before the caret", () => {
    expect(detectSlashTrigger("just plain text", 16)).toBeNull();
  });
});

describe("insertSlashConcept", () => {
  it("replaces '/query' with '/Concept Name ' and places the caret after the space", () => {
    const text = "hello /fou world";
    const trigger = detectSlashTrigger(text, "hello /fou".length)!;
    const result = insertSlashConcept(text, trigger, "Founder-Operator Mindset");
    expect(result.text).toBe("hello /Founder-Operator Mindset  world");
    expect(result.caret).toBe("hello /Founder-Operator Mindset ".length);
  });

  it("works when the trigger is at the very start of the text", () => {
    const text = "/fou";
    const trigger = detectSlashTrigger(text, text.length)!;
    const result = insertSlashConcept(text, trigger, "Founder-Operator Mindset");
    expect(result.text).toBe("/Founder-Operator Mindset ");
    expect(result.caret).toBe(result.text.length);
  });

  it("preserves an empty query (bare '/')", () => {
    const text = "/";
    const trigger = detectSlashTrigger(text, text.length)!;
    const result = insertSlashConcept(text, trigger, "Engineering Excellence");
    expect(result.text).toBe("/Engineering Excellence ");
  });
});
