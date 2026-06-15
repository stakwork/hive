import type { WorkflowVersion } from "@/hooks/useWorkflowVersions";

export interface VersionGroup {
  publishedVersion: WorkflowVersion;
  drafts: WorkflowVersion[]; // unpublished versions between this and next older published
}

export interface GroupedVersions {
  unreleased: WorkflowVersion[]; // unpublished versions newer than latest published
  groups: VersionGroup[]; // published headers, newest first
}

/**
 * Groups workflow versions (assumed newest-first) into:
 * - `unreleased`: unpublished versions newer than the latest published version
 * - `groups`: each published version as a header with its trailing draft versions
 */
export function groupWorkflowVersions(versions: WorkflowVersion[]): GroupedVersions {
  if (versions.length === 0) {
    return { unreleased: [], groups: [] };
  }

  // Find index of first published version
  const firstPublishedIdx = versions.findIndex((v) => v.published);

  // All unpublished — no groups
  if (firstPublishedIdx === -1) {
    return { unreleased: [...versions], groups: [] };
  }

  const unreleased = versions.slice(0, firstPublishedIdx);
  const groups: VersionGroup[] = [];

  // Scan from the first published version onward
  let currentGroup: VersionGroup | null = null;
  for (let i = firstPublishedIdx; i < versions.length; i++) {
    const v = versions[i];
    if (v.published) {
      // Save previous group if any
      if (currentGroup) groups.push(currentGroup);
      currentGroup = { publishedVersion: v, drafts: [] };
    } else {
      // Accumulate drafts into current group
      if (currentGroup) currentGroup.drafts.push(v);
    }
  }
  if (currentGroup) groups.push(currentGroup);

  return { unreleased, groups };
}
