import { db } from '@/lib/db';
import { config } from '@/config/env';

export async function runLlmModelSync(): Promise<{ modelCount: number }> {
  const models = await db.llmModel.findMany({ orderBy: { name: 'asc' } });

  if (!config.STAKWORK_WORKFLOW_ID_LLM_SYNC) {
    throw new Error('STAKWORK_WORKFLOW_ID_LLM_SYNC is not configured');
  }
  if (!config.STAKWORK_API_KEY) {
    throw new Error('STAKWORK_API_KEY is not configured');
  }

  const stakworkURL = `${config.STAKWORK_BASE_URL}/projects`;
  const payload = {
    name: 'llm-model-sync',
    workflow_id: parseInt(config.STAKWORK_WORKFLOW_ID_LLM_SYNC, 10),
    workflow_params: {
      set_var: { attributes: { vars: { models } } },
    },
  };

  const response = await fetch(stakworkURL, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Token token=${config.STAKWORK_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Stakwork responded with ${response.status}: ${response.statusText}`);
  }

  return { modelCount: models.length };
}
