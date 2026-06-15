import { NextRequest, NextResponse } from 'next/server';
import { runLlmModelSync } from '@/lib/ai/llm-model-sync';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[LlmModelSyncCron] Starting LLM model sync run');

    const { modelCount } = await runLlmModelSync();

    console.log('[LlmModelSyncCron] Dispatch successful', { modelCount });

    return NextResponse.json({
      success: true,
      modelCount,
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
