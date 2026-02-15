interface HiveBountyPrefill {
  title: string;
  description: string;
  estimatedHours?: number;
  repositoryUrl?: string;
  source: "hive";
  hiveTaskId: string;
  bountyCode?: string;
  priceUsd?: number; // Price in USD cents
  priceSats?: number; // Price in satoshis
  dueDate?: string; // ISO date string
  staking?: boolean;
  sourceTaskId?: string;
  sourceWorkspaceId?: string;
  sourceWorkspaceSlug?: string;
  sourceUserId?: string;
  targetWorkspaceId?: string;
}

interface TaskData {
  id: string;
  title: string;
  description?: string;
  estimatedHours?: number;
  bountyCode?: string;
  priceUsd?: number;
  priceSats?: number;
  dueDate?: string;
  staking?: boolean;
  sourceTaskId?: string;
  sourceWorkspaceId?: string;
  sourceWorkspaceSlug?: string;
  sourceUserId?: string;
  targetWorkspaceId?: string;
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
    priceUsd: task.priceUsd,
    priceSats: task.priceSats,
    dueDate: task.dueDate,
    staking: task.staking,
    sourceTaskId: task.sourceTaskId,
    sourceWorkspaceId: task.sourceWorkspaceId,
    sourceWorkspaceSlug: task.sourceWorkspaceSlug,
    sourceUserId: task.sourceUserId,
    targetWorkspaceId: task.targetWorkspaceId,
  };

  const encoded = btoa(JSON.stringify(prefillData));
  const sphinxUrl = process.env.NEXT_PUBLIC_SPHINX_TRIBES_URL || "https://bounties.sphinx.chat";

  return `${sphinxUrl}/bounties?action=create&prefill=${encoded}`;
}
