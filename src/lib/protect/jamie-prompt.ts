import { isCodeChangeCapabilityEnabledForOrg } from "@/lib/ai/capabilityGates";
import type { ProtectFinding } from "@/types/protect";

export type ProtectJamieTool = "propose_feature" | "propose_code_change";

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

export async function chooseProtectJamieTool(
  finding: ProtectFinding,
  sourceControlOrgId: string | null | undefined,
): Promise<ProtectJamieTool> {
  const codeChangeEnabled = await isCodeChangeCapabilityEnabledForOrg(
    sourceControlOrgId ?? undefined,
  );
  if (!codeChangeEnabled) return "propose_feature";
  return looksMechanicalSingleFile(finding) ? "propose_code_change" : "propose_feature";
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
    tool === "propose_code_change"
      ? `This looks like a small single-file, single-repo mechanical fix. Use the propose_code_change tool and pass workspaceSlug "${workspaceSlug}" and repositoryUrl "${finding.repositoryUrl}".`
      : `This looks multi-file or ambiguous. Use the propose_feature tool and pass workspaceSlug "${workspaceSlug}" and repositoryUrl "${finding.repositoryUrl}".`;

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
