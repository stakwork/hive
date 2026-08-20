import { NextRequest, NextResponse } from "next/server";
import {
  ATTEMPT_CAP_EVALSET_ID,
  CONCEPT_ONLY_EVALSET_ID,
  EVAL_SET_ID,
  PLATEAU_CAP_EVALSET_ID,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

/**
 * Mock route for POST /graph/search/attributes (searchNodesByAttributes).
 *
 * With USE_MOCKS routing getJarvisUrl at the local mock Jarvis, this endpoint
 * lets attribute searches resolve instead of dead-ending. It answers the one
 * query the legal-benchmark UI needs to boot: the recursion tab's EvalSet
 * listing (`recursion = true`), returning one entry per fixture scenario so
 * the activity rail exercises every fix-chain shape. Every other query gets a
 * successful empty result — callers already treat empty as a graceful state,
 * and an empty success beats a transport error that renders as a failure.
 *
 * Response mirrors the deployed endpoint's `{ status, nodes }` wrapper; the
 * `nodes` array is all `searchNodesByAttributes` reads.
 */

interface SearchAttributesBody {
  node_type?: string[];
  search_filters?: Array<{ attribute?: string; value?: unknown; comparator?: string }>;
}

/** The four fixture EvalSets, shaped as `listRecursionEvalSets` expects:
 *  `properties.id` is the task-slug, `name` the card title. */
const RECURSION_EVALSETS = [
  {
    ref_id: EVAL_SET_ID,
    node_type: "EvalSet",
    properties: { id: "mock-task-001", name: "Mock Legal Benchmark EvalSet", recursion: true },
  },
  {
    ref_id: CONCEPT_ONLY_EVALSET_ID,
    node_type: "EvalSet",
    properties: {
      id: "mock-concept-task-001",
      name: "Concept-only Recursion EvalSet",
      recursion: true,
    },
  },
  {
    ref_id: ATTEMPT_CAP_EVALSET_ID,
    node_type: "EvalSet",
    properties: { id: "mock-task-attempt-cap", name: "Attempt Cap Test EvalSet", recursion: true },
  },
  {
    ref_id: PLATEAU_CAP_EVALSET_ID,
    node_type: "EvalSet",
    properties: { id: "mock-task-plateau-cap", name: "Plateau Cap Test EvalSet", recursion: true },
  },
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: SearchAttributesBody = {};
  try {
    body = (await req.json()) as SearchAttributesBody;
  } catch {
    // empty body → empty result below
  }

  const nodeTypes = (body.node_type ?? []).map((t) => t.toLowerCase());
  const filters = body.search_filters ?? [];

  const wantsEvalSets = nodeTypes.some((t) => t === "evalset");
  const wantsRecursion = filters.some((f) => f.attribute === "recursion");

  if (wantsEvalSets && wantsRecursion) {
    return NextResponse.json({ status: "success", nodes: RECURSION_EVALSETS }, { status: 200 });
  }

  return NextResponse.json({ status: "success", nodes: [] }, { status: 200 });
}
