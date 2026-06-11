import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { MIDDLEWARE_HEADERS } from '@/config/middleware';

vi.mock('@/lib/db', () => ({
  db: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/ai/llm-model-sync', () => ({
  runLlmModelSync: vi.fn(),
}));

import { db } from '@/lib/db';
import { runLlmModelSync } from '@/lib/ai/llm-model-sync';

const mockedDb = vi.mocked(db);
const mockedRunLlmModelSync = vi.mocked(runLlmModelSync);

function makeRequest(userId?: string): NextRequest {
  const req = new NextRequest('http://localhost/api/admin/llm-models/sync', { method: 'POST' });
  if (userId) {
    return new NextRequest('http://localhost/api/admin/llm-models/sync', {
      method: 'POST',
      headers: { [MIDDLEWARE_HEADERS.USER_ID]: userId },
    });
  }
  return req;
}

describe('POST /api/admin/llm-models/sync', () => {
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('@/app/api/admin/llm-models/sync/route');
    POST = mod.POST;
  });

  it('returns 401 when no user ID header is present', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 403 when user is not a super admin', async () => {
    mockedDb.user.findUnique = vi.fn().mockResolvedValue({ role: 'ADMIN' });

    const res = await POST(makeRequest('user-123'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 200 with success and modelCount for super admin', async () => {
    mockedDb.user.findUnique = vi.fn().mockResolvedValue({ role: 'SUPER_ADMIN' });
    mockedRunLlmModelSync.mockResolvedValue({ modelCount: 5 });

    const res = await POST(makeRequest('super-user-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.modelCount).toBe(5);
  });

  it('returns 500 when runLlmModelSync throws', async () => {
    mockedDb.user.findUnique = vi.fn().mockResolvedValue({ role: 'SUPER_ADMIN' });
    mockedRunLlmModelSync.mockRejectedValue(new Error('Stakwork unavailable'));

    const res = await POST(makeRequest('super-user-1'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to run LLM model sync');
  });

  it('does not call runLlmModelSync when auth fails', async () => {
    mockedDb.user.findUnique = vi.fn().mockResolvedValue({ role: 'DEVELOPER' });

    await POST(makeRequest('user-123'));
    expect(mockedRunLlmModelSync).not.toHaveBeenCalled();
  });
});
