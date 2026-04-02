import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/graphmindset/slug-availability/route';
import { db } from '@/lib/db';
import { createTestUser } from '@/__tests__/support/factories';
import { createGetRequest } from '@/__tests__/support/helpers/request-builders';

// Mock environment config
vi.mock('@/config/env', () => ({
  config: {},
  optionalEnvVars: {
    SWARM_SUPER_ADMIN_URL: 'https://swarm-admin.test',
  },
}));

// Mock fetch for the swarm admin API
global.fetch = vi.fn();

function mockSwarmAdminAvailable() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { domain_exists: false, swarm_name_exist: false } }),
  });
}

function mockSwarmAdminTaken() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ success: true, data: { domain_exists: true, swarm_name_exist: true } }),
  });
}

describe('GET /api/graphmindset/slug-availability', () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let createdWorkspaceIds: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    testUser = await createTestUser();
    createdWorkspaceIds = [];
  });

  afterEach(async () => {
    if (createdWorkspaceIds.length > 0) {
      await db.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    }
    await db.user.deleteMany({ where: { id: testUser.id } });
  });

  test('returns 400 when slug param is missing', async () => {
    const req = createGetRequest('/api/graphmindset/slug-availability');
    const response = await GET(req);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Slug parameter is required');
  });

  test('returns isAvailable: false with format error for invalid slug', async () => {
    const req = createGetRequest('/api/graphmindset/slug-availability?slug=a');
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.isAvailable).toBe(false);
    expect(data.data.message).toBeTruthy();
  });

  test('returns isAvailable: false with format error for slug starting with dashes', async () => {
    const req = createGetRequest('/api/graphmindset/slug-availability?slug=--bad');
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.isAvailable).toBe(false);
  });

  test('returns isAvailable: false when slug exists in DB', async () => {
    const slug = `taken-slug-${Date.now()}`;
    const workspace = await db.workspace.create({
      data: {
        id: `ws_test_${Date.now()}`,
        name: 'Taken Workspace',
        slug,
        ownerId: testUser.id,
      },
    });
    createdWorkspaceIds.push(workspace.id);

    const req = createGetRequest(`/api/graphmindset/slug-availability?slug=${slug}`);
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.isAvailable).toBe(false);
    expect(data.data.message).toBe('A workspace with this slug already exists');
    // Should not call swarm admin if DB already shows taken
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns isAvailable: true when not in DB and swarm admin returns domain_exists: false', async () => {
    mockSwarmAdminAvailable();

    const slug = `available-slug-${Date.now()}`;
    const req = createGetRequest(`/api/graphmindset/slug-availability?slug=${slug}`);
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.isAvailable).toBe(true);
    expect(global.fetch).toHaveBeenCalledOnce();
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      `${slug}.sphinx.chat`
    );
  });

  test('returns isAvailable: false with vanity message when swarm admin returns domain_exists: true', async () => {
    mockSwarmAdminTaken();

    const slug = `vanity-taken-${Date.now()}`;
    const req = createGetRequest(`/api/graphmindset/slug-availability?slug=${slug}`);
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.isAvailable).toBe(false);
    expect(data.data.message).toBe(
      'This name is already in use as a graph workspace. Please choose a different name.'
    );
  });

  test('falls back to DB-only result (isAvailable: true) when swarm admin fetch throws', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

    const slug = `fallback-slug-${Date.now()}`;
    const req = createGetRequest(`/api/graphmindset/slug-availability?slug=${slug}`);
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.isAvailable).toBe(true);
  });

  test('falls back to DB-only result when SWARM_SUPER_ADMIN_URL is not configured', async () => {
    // Override the env mock for this test
    vi.doMock('@/config/env', () => ({
      config: {},
      optionalEnvVars: {
        SWARM_SUPER_ADMIN_URL: undefined,
      },
    }));

    const slug = `no-swarm-url-${Date.now()}`;
    const req = createGetRequest(`/api/graphmindset/slug-availability?slug=${slug}`);
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    // fetch should not have been called (no URL)
    // Result depends on whether slug is in DB — it won't be, so isAvailable: true
    expect(data.data.isAvailable).toBe(true);
  });
});
