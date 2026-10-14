import type { ProtectFinding } from "@/types/protect";

export type ProtectJamieTool = "discuss" | "start_job";

function looksMechanicalSingleFile(finding: ProtectFinding): boolean {
  if (!finding.file || finding.file.includes(",") || finding.file.includes(" ")) {
    return false;
  }
  const text = `${finding.title}\n${finding.description}\n${finding.recommendation}`.toLowerCase();
  const ambiguousHints = [
    "multiple files",
    "across files",
    "architecture",
    "refactor",
    "redesign",
    "ambiguous",
    "unclear",
  ];
  if (ambiguousHints.some((hint) => text.includes(hint))) return false;
  return Boolean(finding.repositoryUrl);
}

export function chooseProtectJamieTool(finding: ProtectFinding): ProtectJamieTool {
  return looksMechanicalSingleFile(finding) ? "start_job" : "discuss";
}

export function buildProtectJamieSeed(
  finding: ProtectFinding,
  tool: ProtectJamieTool,
  workspaceSlug: string,
): string {
  const evidence =
    finding.category === "secret"
      ? "(redacted — secret-category evidence is not included)"
      : finding.evidence || "(none)";

  const toolInstruction =
    tool === "start_job"
      ? `This looks like a small single-file, single-repo mechanical fix. Make it as a job: use the start_job tool with workspace "${workspaceSlug}", and name the repository ${finding.repositoryUrl} in the job's prompt.`
      : `This looks multi-file or ambiguous. Do not start a job yet: investigate read-only in workspace "${workspaceSlug}" (repository ${finding.repositoryUrl || "unknown"}), then confirm the scope with the user in chat before making any change.`;

  return [
    "You are helping a workspace member act on a single Protect security finding.",
    "Work on this finding only. Do not batch other findings.",
    toolInstruction,
    "",
    `Title: ${finding.title}`,
    `Category: ${finding.category}`,
    `Severity: ${finding.severity}`,
    `Area: ${finding.area || "(none)"}`,
    `Workspace: ${workspaceSlug}`,
    `Repository: ${finding.repositoryUrl}`,
    `File: ${finding.file}`,
    `Line: ${finding.line ?? "(unknown)"}`,
    `Status: ${finding.status}`,
    `Verification: ${finding.verification ?? "unverified"}`,
    "",
    "Description:",
    finding.description || "(none)",
    "",
    "Evidence:",
    evidence,
    "",
    "Recommendation:",
    finding.recommendation || "(none)",
  ].join("\n");
}
