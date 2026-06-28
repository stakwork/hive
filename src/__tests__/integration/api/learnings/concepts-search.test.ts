import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/learnings/concepts/search/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from '@/__tests__/support/fixtures';
import {
  createAuthenticatedGetRequest,
  createGetRequest,
  generateUniqueId,
} from '@/__tests__/support/helpers';
import type { User, Workspace, Swarm } from '@prisma/client';

/** Build a minimal concepts fetch Response */
function makeConceptsResponse(concepts: object[]) {
  return new Response(JSON.stringify(concepts), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a minimal search-clues fetch Response */
function makeSearchCluesResponse(results: object[]) {
  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SWARM_API_KEY = 'test-concept-search-api-key';

const MOCK_CONCEPTS = [
  { id: 'hive/auth', name: 'Authentication', content: 'Handles JWT and OAuth flows.' },
  { id: 'hive/tasks', name: 'Task Management', content: 'Dual status task system.' },
  { id: 'hive/workspace', name: 'Workspace Access', content: 'Role-based access control.' },
];

describe('GET /api/learnings/concepts/search — Validation', () => {
  let owner: User;
  let workspace: Workspace;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: 'ConceptSearch Validation Owner' },
    });
    owner = scenario.owner;
    workspace = scenario.workspace;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when workspace parameter is missing', async () => {
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('workspace');
  });

  it('returns 400 when q is fewer than 2 characters', async () => {
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'a' }
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('2 characters');
  });

  it('returns 400 when q is empty string', async () => {
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: '' }
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
  });

  it('returns 400 when q consists only of whitespace under 2 chars', async () => {
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: ' ' }
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
  });
});

describe('GET /api/learnings/concepts/search — Authorization', () => {
  let owner: User;
  let workspace: Workspace;
  let nonMember: User;
  let memberViewer: User;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: 'ConceptSearch Auth Owner' },
      members: [{ role: 'VIEWER' }],
    });
    owner = scenario.owner;
    workspace = scenario.workspace;
    memberViewer = scenario.members[0];

    nonMember = await db.user.create({
      data: {
        name: 'Non Member',
        email: `non-member-cs-${generateUniqueId('user')}@example.com`,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const request = createGetRequest('/api/learnings/concepts/search', {
      workspace: workspace.slug,
      q: 'auth',
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it('returns 403 for non-member requests', async () => {
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      nonMember,
      { workspace: workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe('Access denied');
  });

  it('allows VIEWER members to search (read access)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeConceptsResponse(MOCK_CONCEPTS)
    );

    // Need a swarm configured for the workspace
    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', SWARM_API_KEY);
    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `cs-viewer-swarm-${generateUniqueId('swarm')}`,
      status: 'ACTIVE',
    });
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmUrl: 'https://test-cs.sphinx.chat',
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    // Second fetch call for search-clues returns empty results
    fetchSpy
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(makeSearchCluesResponse([]));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      memberViewer,
      { workspace: workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
  });
});

describe('GET /api/learnings/concepts/search — Literal Matching', () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: 'ConceptSearch Literal Owner' },
    });
    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', SWARM_API_KEY);
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `cs-literal-swarm-${generateUniqueId('swarm')}`,
      status: 'ACTIVE',
    });
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmUrl: 'https://test-cs-literal.sphinx.chat',
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns literal matches when concept name matches q (case-insensitive)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(makeSearchCluesResponse([]));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'AUTHEN' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.literal).toHaveLength(1);
    expect(data.literal[0].id).toBe('hive/auth');
    expect(data.literal[0].name).toBe('Authentication');
    expect(data.semantic).toHaveLength(0);
  });

  it('returns literal matches when concept content matches q', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(makeSearchCluesResponse([]));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'dual status' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.literal).toHaveLength(1);
    expect(data.literal[0].id).toBe('hive/tasks');
  });

  it('returns literal matches when concept documentation field matches q', async () => {
    const conceptsWithDoc = [
      { id: 'hive/auth', name: 'Authentication', documentation: 'Handles OAuth2 token refresh.' },
    ];
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(conceptsWithDoc))
      .mockResolvedValueOnce(makeSearchCluesResponse([]));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'token refresh' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.literal).toHaveLength(1);
    expect(data.literal[0].id).toBe('hive/auth');
  });

  it('returns multiple literal matches across concepts', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(makeSearchCluesResponse([]));

    // Both "Authentication" name and "role-based access control" content match "access"
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'access' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    // "Workspace Access" (name match) should be in literal results
    expect(data.literal.some((c: { id: string }) => c.id === 'hive/workspace')).toBe(true);
  });

  it('returns empty literal array when no concepts match', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(makeSearchCluesResponse([]));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'zxqwerty99' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.literal).toHaveLength(0);
    expect(data.semantic).toHaveLength(0);
  });
});

describe('GET /api/learnings/concepts/search — Semantic Matching', () => {
  let owner: User;
  let workspace: Workspace;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: 'ConceptSearch Semantic Owner' },
    });
    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', SWARM_API_KEY);
    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `cs-semantic-swarm-${generateUniqueId('swarm')}`,
      status: 'ACTIVE',
    });
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmUrl: 'https://test-cs-semantic.sphinx.chat',
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns semantic matches for concepts found only by vector search', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(
        makeSearchCluesResponse([
          {
            clue: { id: 'hive/tasks', content: 'task status tracking' },
            score: 0.8,
            relevanceBreakdown: { vector: 0.8, content: 0.6, centrality: 0.5 },
          },
        ])
      );

    // Query matches no literal names/content but swarm returns semantic result
    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'workflow automation' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.literal).toHaveLength(0);
    expect(data.semantic).toHaveLength(1);
    expect(data.semantic[0].id).toBe('hive/tasks');
  });

  it('deduplicates semantic results already in literal matches', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(
        makeSearchCluesResponse([
          {
            // hive/auth matches both literal (name "Authentication") and semantic
            clue: { id: 'hive/auth', content: 'OAuth' },
            score: 0.9,
            relevanceBreakdown: { vector: 0.9, content: 0.8, centrality: 0.6 },
          },
          {
            clue: { id: 'hive/workspace', content: 'RBAC' },
            score: 0.75,
            relevanceBreakdown: { vector: 0.75, content: 0.6, centrality: 0.4 },
          },
        ])
      );

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      // "auth" matches "Authentication" name → literal; hive/auth should NOT also appear in semantic
      { workspace: workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    const literalIds = data.literal.map((c: { id: string }) => c.id);
    const semanticIds = data.semantic.map((c: { id: string }) => c.id);

    // hive/auth is a literal match
    expect(literalIds).toContain('hive/auth');
    // hive/auth must NOT appear in semantic too
    expect(semanticIds).not.toContain('hive/auth');
    // hive/workspace may appear in semantic
    expect(semanticIds).toContain('hive/workspace');
  });

  it('excludes semantic results with vector score below minScore (0.73)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(
        makeSearchCluesResponse([
          {
            clue: { id: 'hive/tasks', content: 'low relevance' },
            score: 0.5,
            relevanceBreakdown: { vector: 0.5, content: 0.4, centrality: 0.3 },
          },
        ])
      );

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'workflow' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    // searchClues() already filters on relevanceBreakdown.vector >= 0.73; low score excluded
    expect(data.semantic).toHaveLength(0);
  });

  it('ignores semantic matches for concept ids not in the concept list', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      .mockResolvedValueOnce(
        makeSearchCluesResponse([
          {
            // id does not exist in MOCK_CONCEPTS
            clue: { id: 'hive/unknown-concept', content: 'something' },
            score: 0.9,
            relevanceBreakdown: { vector: 0.9, content: 0.8, centrality: 0.5 },
          },
        ])
      );

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'something' }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.semantic).toHaveLength(0);
  });
});

describe('GET /api/learnings/concepts/search — Upstream Errors', () => {
  let owner: User;
  let workspace: Workspace;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: 'ConceptSearch Error Owner' },
    });
    owner = scenario.owner;
    workspace = scenario.workspace;

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey = encryptionService.encryptField('swarmApiKey', SWARM_API_KEY);
    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `cs-error-swarm-${generateUniqueId('swarm')}`,
      status: 'ACTIVE',
    });
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        swarmUrl: 'https://test-cs-error.sphinx.chat',
        swarmApiKey: JSON.stringify(encryptedApiKey),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 when swarm concepts fetch returns non-OK status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('Failed to fetch concepts');
  });

  it('returns 500 when swarm concepts fetch throws a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(500);
  });

  it('returns literal results (not 500) when semantic search fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeConceptsResponse(MOCK_CONCEPTS))
      // semantic fetch throws
      .mockRejectedValueOnce(new Error('Search-clues unavailable'));

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      owner,
      { workspace: workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    // Semantic failures are non-fatal; literal results still returned
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.literal.length).toBeGreaterThan(0);
    expect(data.semantic).toHaveLength(0);
  });

  it('returns 404 when workspace has no swarm configured', async () => {
    // Create a workspace with no swarm
    const noSwarmScenario = await createTestWorkspaceScenario({
      owner: { name: 'ConceptSearch No Swarm Owner' },
    });

    const request = createAuthenticatedGetRequest(
      '/api/learnings/concepts/search',
      noSwarmScenario.owner,
      { workspace: noSwarmScenario.workspace.slug, q: 'auth' }
    );
    const response = await GET(request);

    expect(response.status).toBe(404);
  });
});
