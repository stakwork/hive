/**
 * Mock mode: Jamie on the infinite canvas, scripted. When the canvas-scope
 * block names an initiative (the "## Current initiative" section) or the user
 * asks for a new one, the mock model answers here instead of with canned text,
 * and starts the fake strut job the real Jamie would start — so the whole
 * journey (create → build out → accept → brainstorm → resume) runs locally.
 * Anything else falls through to the generic mock reply.
 */

import {
  mockCreateInitiative,
  mockInitiativeTree,
  startMockBrainstorm,
  startMockInitiativeBuild,
} from "@/app/api/mock/graph/initiative-fixture";
import { mockMarkdownArtifact, mockPullRequestArtifact, startMockCanvasJob } from "@/app/api/mock/graph/canvas-jobs";
import { initiativeStage, stageLine } from "@/services/graph/workbench";

interface MockMessage {
  role: string;
  content?: unknown;
}

const textOf = (m: MockMessage): string =>
  typeof m.content === "string"
    ? m.content
    : Array.isArray(m.content)
      ? m.content
          .map((c) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
          .join("")
      : "";

interface Focus {
  ref: string;
  name: string;
  workspaceSlug?: string;
  selected?: { type: string; label: string; ref: string };
}

function focusOf(scope: string): Focus | null {
  const m = scope.match(/on initiative "([^"]*)" \(`([^`]+)`\)(?: in workspace `([^`]+)`)?/);
  if (!m) return null;
  const sel = scope.match(/selected the (\w+) "([^"]*)" \(`([^`]+)`\)/);
  return {
    name: m[1],
    ref: m[2],
    ...(m[3] ? { workspaceSlug: m[3] } : {}),
    ...(sel ? { selected: { type: sel[1], label: sel[2], ref: sel[3] } } : {}),
  };
}

/** The fake job as a marker on the card it was asked about — nothing when the scope names no workspace. */
function canvasJob(focus: Focus, title: string, refId = focus.selected?.ref ?? focus.ref) {
  if (!focus.workspaceSlug) return undefined;
  return startMockCanvasJob({ title, workspaceSlug: focus.workspaceSlug, initiativeRefId: focus.ref, refId });
}

/** The cards a brainstorm can be about. */
const BRAINSTORMABLE = ["HiveInitiative", "HiveMilestone", "InitiativeFeature"];

/** The scripted reply for this request, or null to fall through. */
export function scriptedJamieReply(messages: MockMessage[]): string | null {
  const users = messages.filter((m) => m.role === "user").map(textOf);
  const scope = [...users].reverse().find((t) => t.startsWith("<canvas-scope>")) ?? "";
  const said =
    [...users]
      .reverse()
      .find((t) => t.trim() && !t.startsWith("<canvas-scope>"))
      ?.trim() ?? "";
  // Only Jamie's own turn carries the scope block; title and follow-up calls never start a job.
  if (!scope) return null;
  const focus = focusOf(scope);

  const create = said.match(/create (?:an |a new |a )?initiative\b[:\s-]*(.+)/i);
  if (create) {
    const [rawName, ...rest] = create[1].split(/\s+(?:because|so that|—|-{1,2}|:)\s+|\.\s+/);
    const name =
      rawName
        .replace(/^["']|["'.]$/g, "")
        .trim()
        .slice(0, 80) || "New initiative";
    const why = rest.join(". ").trim();
    mockCreateInitiative(name, why || undefined);
    return [
      `I've created **${name}** on the canvas${why ? " with its brief" : ""}.`,
      "",
      why ? `> ${why}` : "Tell me **why** we're doing it and I'll write the brief.",
      "",
      "Next I can break it into milestones, features, user stories and requirements. Open it and say **build it out** when you're ready.",
    ].join("\n");
  }

  if (!focus) return null;
  const tree = mockInitiativeTree(focus.ref);
  const stage = stageLine(initiativeStage(tree.nodes));

  if (/\bimplement\b/i.test(said) && focus.selected?.type === "InitiativeFeature") {
    // The build: a job on the feature that opens a pull request a moment later.
    const f = focus.selected;
    const job = canvasJob(focus, `Implement ${f.label}`, f.ref);
    const number = 5700 + Math.floor(Math.random() * 200);
    setTimeout(() => job?.step("pod"), 1200);
    setTimeout(() => job?.done([mockPullRequestArtifact("stakwork/hive", number, f.label)]), 3500);
    return [
      `Started a job to implement **${f.label}** from its architecture.`,
      "",
      "Its pull requests show on the feature as they open.",
    ].join("\n");
  }

  if (/\bbrainstorm\b/i.test(said)) {
    // A brainstorm is about the card in view: the initiative, a milestone or a feature.
    const on =
      focus.selected && BRAINSTORMABLE.includes(focus.selected.type)
        ? { ref: focus.selected.ref, name: focus.selected.label, type: focus.selected.type }
        : { ref: focus.ref, name: focus.name, type: "HiveInitiative" };
    const job = canvasJob(focus, `Brainstorm ${on.name}`, on.ref);
    const question =
      on.type === "HiveInitiative" ? `How should we stage ${on.name}?` : `How should we build ${on.name}?`;
    startMockBrainstorm(on.ref, on.name, on.type);
    const makes = on.type === "HiveInitiative" ? "milestones" : on.type === "HiveMilestone" ? "features" : "tasks";
    job?.done([
      mockMarkdownArtifact(
        `brainstorm-${on.ref}`,
        question,
        `Three answers, weighed on fast, good and cheap. Choosing one makes its ${makes}.`,
      ),
    ]);
    return [
      `Started a brainstorm on **${on.name}**: "${question}" with three answers.`,
      "",
      `It hangs off the card on the canvas. Choose an answer there and I'll add the ${makes} it makes.`,
    ].join("\n");
  }

  if (/\b(build|break|flesh|plan)\b.*\b(out|down|it|this)\b|\bwrite (the )?(plan|requirements)\b/i.test(said)) {
    // The marker is made once the build starts; its writes come later, on timers.
    let job: ReturnType<typeof canvasJob>;
    const started = startMockInitiativeBuild(focus.ref, {
      step: () => job?.step(),
      done: (written) =>
        job?.done([
          mockMarkdownArtifact(
            `initiative-build-${focus.ref}`,
            `Plan for ${focus.name}`,
            `strut wrote ${written} cards on **${focus.name}**: the brief, user stories and requirements (proposed, for you to accept or drop), milestones that schedule them, and features.`,
          ),
        ]),
    });
    if (started) job = canvasJob(focus, `Build out ${focus.name}`, focus.ref);
    if (!started)
      return tree.building
        ? `strut is still writing **${focus.name}**. The cards appear as it goes.`
        : `**${focus.name}** already has a plan (${stage}). Open a milestone or a feature and tell me what to change.`;
    return [
      `On it. I've started strut's **initiative-build** job on **${focus.name}**.`,
      "",
      "It writes in order: the brief if there isn't one, then the user stories and their requirements, milestones that schedule them, and features. Watch the cards appear on the canvas. Requirements land as **proposed** for you to accept or drop.",
    ].join("\n");
  }

  if (/\b(next|where (are|were) we|status|resume|continue|pick up)\b/i.test(said) || !said) {
    const s = initiativeStage(tree.nodes);
    const next = !tree.nodes.some((n) => n.type === "Brief")
      ? "write the brief: tell me why we're doing this"
      : !s.milestones
        ? "break it into milestones"
        : !s.features
          ? "add features under each milestone (say **build it out**)"
          : s.unaccepted
            ? `accept or drop the ${s.unaccepted} proposed requirement${s.unaccepted === 1 ? "" : "s"}`
            : "brainstorm how to build a milestone: open one and say **brainstorm this**";
    return `**${focus.name}**: ${stage}. Picking up from the graph, the next step is to ${next}.`;
  }

  return `I'm looking at **${focus.name}** (${stage})${focus.selected ? `, with the ${focus.selected.type.replace(/^Hive|^Initiative/, "").toLowerCase()} "${focus.selected.label}" selected` : ""}. I can **build it out**, **brainstorm** whatever you have open, or tell you **what's next**.`;
}
