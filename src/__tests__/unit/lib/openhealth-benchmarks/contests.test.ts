/**
 * Unit tests for `lib/openhealth-benchmarks/contests.ts`: contested gold as
 * the three OpenHealth workflows name it → one shape.
 */

import { describe, it, expect } from "vitest";
import { contestNames, contestsOf, rejectedContestsOf } from "@/lib/openhealth-benchmarks/contests";

describe("contestsOf", () => {
  it("reads a run's contested items in full", () => {
    expect(
      contestsOf([
        {
          id: "oh-patient-diagnosis-public-7006-contested-diagnoses-o34211",
          ref_id: "r1",
          list: "diagnoses",
          name: "Prior cesarean",
          icd10: "O34211",
          reason: "The chart documents no prior cesarean.",
          evidence: ['chart.md: "No prior surgeries"'],
        },
      ]),
    ).toEqual([
      {
        id: "oh-patient-diagnosis-public-7006-contested-diagnoses-o34211",
        refId: "r1",
        name: "Prior cesarean",
        list: "diagnoses",
        icd10: "O34211",
        reason: "The chart documents no prior cesarean.",
        evidence: ['chart.md: "No prior surgeries"'],
      },
    ]);
  });

  it("takes a bare name (the loop's history) as an item with nothing else", () => {
    expect(contestsOf(["Primigravida", ""])).toEqual([
      { id: null, refId: null, name: "Primigravida", list: null, icd10: null, reason: null, evidence: [] },
    ]);
  });

  it("quotes an improve run's evidence with its source, and falls back to a description", () => {
    expect(
      contestsOf([
        {
          name: "Primigravida",
          description: "Contested: the chart documents a prior pregnancy.",
          evidence: [{ source: "chart", quote: "G2P1" }, { quote: "no source" }, { source: "gold" }, 3],
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        reason: "Contested: the chart documents a prior pregnancy.",
        evidence: ['chart: "G2P1"', "no source"],
      }),
    ]);
  });

  it("drops what has no name, and anything that is not a list", () => {
    expect(contestsOf([{ id: "x" }, null, 4, { display_name: "By display name" }])).toEqual([
      expect.objectContaining({ name: "By display name" }),
    ]);
    expect(contestsOf(null)).toEqual([]);
    expect(contestsOf({ name: "not a list" })).toEqual([]);
    expect(contestNames([{ name: "A" }, "B", {}])).toEqual(["A", "B"]);
  });
});

describe("rejectedContestsOf", () => {
  it("reads an improve run's refusals and a run's not-accepted contests", () => {
    expect(
      rejectedContestsOf([
        { error_id: "1790972203341/iter-0:missed_finding:proteinuria", why: "The quote is not in the chart." },
        { name: "Upper abdominal pain", description: "TEST ONLY" },
        { why: "no error" },
        "x",
      ]),
    ).toEqual([
      { error: "1790972203341/iter-0:missed_finding:proteinuria", reason: "The quote is not in the chart." },
      { error: "Upper abdominal pain", reason: "TEST ONLY" },
    ]);
    expect(rejectedContestsOf(undefined)).toEqual([]);
  });
});
