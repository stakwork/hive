interface HiveBountyPrefill {
  title: string;
  description: string;
  estimatedHours?: number;
  repositoryUrl?: string;
  source: "hive";
  hiveTaskId: string;
  bountyCode?: string;
}

interface TaskData {
  id: string;
  title: string;
  description?: string;
  estimatedHours?: number;
  bountyCode?: string;
  repository?: {
    repositoryUrl?: string;
  };
}

export function generateSphinxBountyUrl(task: TaskData): string {
  const prefillData: HiveBountyPrefill = {
    title: task.title,
    description: task.description || "",
    estimatedHours: task.estimatedHours,
    repositoryUrl: task.repository?.repositoryUrl,
    source: "hive",
    hiveTaskId: task.id,
    bountyCode: task.bountyCode,
  };

  const encoded = btoa(JSON.stringify(prefillData));
  const sphinxUrl = process.env.NEXT_PUBLIC_SPHINX_TRIBES_URL || "https://bounties.sphinx.chat";

  return `${sphinxUrl}/bounties?action=create&prefill=${encoded}`;
}
