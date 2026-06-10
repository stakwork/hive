import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth/require-superadmin';
import { runLlmModelSync } from '@/lib/ai/llm-model-sync';

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const { modelCount } = await runLlmModelSync();
    return NextResponse.json({ success: true, modelCount });
  } catch (error) {
    console.error('[LlmModelSync] Error running manual sync:', error);
    return NextResponse.json({ error: 'Failed to run LLM model sync' }, { status: 500 });
  }
}
