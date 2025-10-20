interface HiveBountyPrefill {
  title: string;
  description: string;
  estimatedHours?: number;
  repositoryUrl?: string;
  source: "hive";
  hiveTaskId: string;
}

interface TaskData {
  id: string;
  title: string;
  description?: string;
  estimatedHours?: number;
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
  };

  const encoded = btoa(JSON.stringify(prefillData));
  const sphinxUrl = process.env.NEXT_PUBLIC_SPHINX_TRIBES_URL || "https://community.sphinx.chat";

  return `${sphinxUrl}/bounties?action=create&prefill=${encoded}`;
}
