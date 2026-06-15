import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';

vi.mock('@/lib/db');
vi.mock('@/config/env', () => ({
  config: {
    STAKWORK_BASE_URL: 'https://api.stakwork.com/api/v1',
    STAKWORK_API_KEY: 'test-api-key',
    STAKWORK_WORKFLOW_ID_LLM_SYNC: '42',
  },
}));

const mockedDb = vi.mocked(db);

const mockModels = [
  { id: '1', name: 'claude-3-5-sonnet', provider: 'ANTHROPIC' },
  { id: '2', name: 'gpt-4o', provider: 'OPENAI' },
];

describe('runLlmModelSync', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.doMock('@/config/env', () => ({
      config: {
        STAKWORK_BASE_URL: 'https://api.stakwork.com/api/v1',
        STAKWORK_API_KEY: 'test-api-key',
        STAKWORK_WORKFLOW_ID_LLM_SYNC: '42',
      },
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('fetches all models ordered by name and posts to Stakwork', async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', mockFetch);

    const { runLlmModelSync } = await import('@/lib/ai/llm-model-sync');
    const result = await runLlmModelSync();

    expect(mockedDb.llmModel.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
    expect(result).toEqual({ modelCount: 2 });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.stakwork.com/api/v1/projects');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Token token=test-api-key');
    expect(opts.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.name).toBe('llm-model-sync');
    expect(body.workflow_id).toBe(42);
    expect(body.workflow_params.set_var.attributes.vars.models).toEqual(mockModels);
  });

  it('throws when STAKWORK_WORKFLOW_ID_LLM_SYNC is not configured', async () => {
    vi.doMock('@/config/env', () => ({
      config: {
        STAKWORK_BASE_URL: 'https://api.stakwork.com/api/v1',
        STAKWORK_API_KEY: 'test-api-key',
        STAKWORK_WORKFLOW_ID_LLM_SYNC: undefined,
      },
    }));
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);

    const { runLlmModelSync } = await import('@/lib/ai/llm-model-sync');
    await expect(runLlmModelSync()).rejects.toThrow('STAKWORK_WORKFLOW_ID_LLM_SYNC');
  });

  it('throws when STAKWORK_API_KEY is not configured', async () => {
    vi.doMock('@/config/env', () => ({
      config: {
        STAKWORK_BASE_URL: 'https://api.stakwork.com/api/v1',
        STAKWORK_API_KEY: undefined,
        STAKWORK_WORKFLOW_ID_LLM_SYNC: '42',
      },
    }));
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);

    const { runLlmModelSync } = await import('@/lib/ai/llm-model-sync');
    await expect(runLlmModelSync()).rejects.toThrow('STAKWORK_API_KEY');
  });

  it('throws when Stakwork responds with a non-ok status', async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 422, statusText: 'Unprocessable Entity' }),
    );

    const { runLlmModelSync } = await import('@/lib/ai/llm-model-sync');
    await expect(runLlmModelSync()).rejects.toThrow('422');
  });

  it('throws when fetch rejects', async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

    const { runLlmModelSync } = await import('@/lib/ai/llm-model-sync');
    await expect(runLlmModelSync()).rejects.toThrow('Network failure');
  });
});
