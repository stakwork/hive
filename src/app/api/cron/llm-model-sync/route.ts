import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { config } from '@/config/env';

export async function GET(request: NextRequest) {
  try {
    // Auth — must match CRON_SECRET (same pattern as all other crons)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[LlmModelSyncCron] Starting LLM model sync run');

    // Query all LLM models
    const models = await db.llmModel.findMany({ orderBy: { name: 'asc' } });
    console.log(`[LlmModelSyncCron] Found ${models.length} models`);

    // Guard: workflow ID must be configured
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

    console.log('[LlmModelSyncCron] Dispatching to Stakwork', {
      workflowId: payload.workflow_id,
      modelCount: models.length,
    });

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

    const result = await response.json();
    console.log('[LlmModelSyncCron] Dispatch successful', result);

    return NextResponse.json({
      success: true,
      modelCount: models.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[LlmModelSyncCron] Unhandled error:', errorMessage);
    return NextResponse.json(
      { success: false, error: errorMessage, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
