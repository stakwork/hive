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
 * listing (`recursion = true` / `recursion = false`), returning live-on
 * fixtures for true and a distinct live-off set for false so the tab can
 * exercise “listed but not dispatched.” Every other query gets a
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

/** Live-on fixture EvalSets (`recursion: true`), shaped as `listRecursionEvalSets` expects:
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

/** Live-off fixtures: `recursion: false` with leftover `recursionEnabledAt` so the
 *  Recursion tab under USE_MOCKS can exercise “listed but not dispatched.” */
const DISABLED_RECURSION_EVALSETS = [
  {
    ref_id: "mock-evalset-disabled-001",
    node_type: "EvalSet",
    properties: {
      id: "mock-task-disabled",
      name: "Disabled Recursion EvalSet",
      recursion: false,
      recursionEnabledAt: 1700000000,
    },
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
  const recursionFilter = filters.find((f) => f.attribute === "recursion");

  if (wantsEvalSets && recursionFilter) {
    if (recursionFilter.value === false) {
      return NextResponse.json(
        { status: "success", nodes: DISABLED_RECURSION_EVALSETS },
        { status: 200 },
      );
    }
    if (recursionFilter.value === true) {
      return NextResponse.json({ status: "success", nodes: RECURSION_EVALSETS }, { status: 200 });
    }
  }

  return NextResponse.json({ status: "success", nodes: [] }, { status: 200 });
}
