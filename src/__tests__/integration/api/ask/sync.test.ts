import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAuthenticatedPostRequest,
  createPostRequest,
  createRequestWithHeaders,
} from '@/__tests__/support/helpers/request-builders';
import {
  createTestUser,
  createTestWorkspace,
  createTestSwarm,
  createTestRepository,
} from '@/__tests__/support/fixtures';
import { generateUniqueId } from '@/__tests__/support/helpers/ids';
import { POST } from '@/app/api/ask/sync/route';
import { db } from '@/lib/db';
import { EncryptionService } from '@/lib/encryption';

// Skip `after()` side effects in tests (cache persist / research workers).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn(() => undefined) };
});

// Mock the AI streaming engine. The sync route awaits `consumeStream()` +
// `steps` rather than streaming, so the mock returns those. Keep the rest
// of the `ai` exports real — `runCanvasAgent` + `buildDeferredCheckTools`
// use `tool()`, `stepCountIs`, etc.
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, streamText: vi.fn() };
});

vi.mock('@/lib/ai/provider', () => ({
  getModel: vi.fn(),
  getApiKeyForProvider: vi.fn(() => 'test-api-key'),
}));

vi.mock('@/lib/ai/askTools', () => ({
  askTools: vi.fn(() => ({})),
  listConcepts: vi.fn(() => Promise.resolve({ features: [] })),
  createHasEndMarkerCondition: vi.fn(() => () => false),
  clueToolMsgs: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/constants/prompt', () => ({
  getQuickAskPrefixMessages: vi.fn(() => []),
  getMultiWorkspacePrefixMessages: vi.fn(() => []),
  getRoadmapCapabilitySnippet: vi.fn(() => ''),
  getWhiteboardCapabilitySnippet: vi.fn(() => ''),
  getPlannerCapabilitySnippet: vi.fn(() => ''),
  getResearchCapabilitySnippet: vi.fn(() => ''),
  getConnectionsCapabilitySnippet: vi.fn(() => ''),
  getCanvasPromptSuffix: vi.fn(() => ''),
}));

vi.mock('@/lib/pusher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pusher')>();
  return {
    ...actual,
    pusherServer: { trigger: vi.fn() },
    notifyCanvasConversationUpdated: vi.fn(),
  };
});

import { streamText } from 'ai';
import { getModel } from '@/lib/ai/provider';

const encryptionService = EncryptionService.getInstance();

/** A finished-stream stub: the sync route only touches these two members. */
function mockFinishedStream(steps: unknown[]) {
  return {
    consumeStream: vi.fn(() => Promise.resolve()),
    steps: Promise.resolve(steps),
  };
}

/**
 * Create an org-linked workspace fully wired for the canvas agent: a
 * `SourceControlOrg`, an owner with a PAT + SourceControlToken, a swarm,
 * and a repository.
 */
async function setupOrgWorkspace() {
  const owner = await createTestUser({
    email: generateUniqueId('owner') + '@example.com',
    withGitHubAuth: true,
  });
  const org = await db.sourceControlOrg.create({
    data: {
      githubLogin: generateUniqueId('org'),
      githubInstallationId: Math.floor(Math.random() * 1_000_000),
      type: 'ORG',
      name: 'Test Org',
    },
  });
  const token = encryptionService.encryptField(
    'source_control_token',
    'github_pat_test_token',
  );
  await db.sourceControlToken.create({
    data: {
      userId: owner.id,
      sourceControlOrgId: org.id,
      token: JSON.stringify(token),
      scopes: ['repo'],
    },
  });
  const workspace = await createTestWorkspace({
    slug: generateUniqueId('workspace'),
    ownerId: owner.id,
  });
  await db.workspace.update({
    where: { id: workspace.id },
    data: { sourceControlOrgId: org.id },
  });
  await createTestSwarm({
    workspaceId: workspace.id,
    swarmUrl: 'https://test-swarm.sphinx.chat',
    swarmApiKey: 'test-key',
  });
  await createTestRepository({
    workspaceId: workspace.id,
    repositoryUrl: 'https://github.com/test-org/test-repo',
  });
  return { owner, org, workspace };
}

describe('POST /api/ask/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = 'test-api-token';
    vi.mocked(getModel).mockResolvedValue({
      modelId: 'test-model',
      provider: 'anthropic',
    } as any);
  });

  describe('Auth & validation', () => {
    it('returns 401 with neither a session nor an API token', async () => {
      const request = createPostRequest('/api/ask/sync', {
        message: 'hello',
        workspaceSlug: 'some-workspace',
      });
      const response = await POST(request);
      expect(response.status).toBe(401);
    });

    it('returns 400 when message is missing', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });
      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });
      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        { workspaceSlug: workspace.slug },
        user,
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('message');
    });

    it('returns 400 when workspaceSlug is missing', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });
      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        { message: 'hi' },
        user,
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('workspaceSlug');
    });

    it('returns 404 when the workspace does not exist', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
      });
      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        { message: 'hi', workspaceSlug: 'does-not-exist' },
        user,
      );
      const response = await POST(request);
      expect(response.status).toBe(404);
    });

    it('returns 403 for a non-member', async () => {
      const { workspace } = await setupOrgWorkspace();
      const outsider = await createTestUser({
        email: generateUniqueId('outsider') + '@example.com',
      });
      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        { message: 'hi', workspaceSlug: workspace.slug },
        outsider,
      );
      const response = await POST(request);
      expect(response.status).toBe(403);
    });

    it('returns 400 when the workspace has no linked org', async () => {
      const user = await createTestUser({
        email: generateUniqueId('user') + '@example.com',
        withGitHubAuth: true,
      });
      const workspace = await createTestWorkspace({
        slug: generateUniqueId('workspace'),
        ownerId: user.id,
      });
      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        { message: 'hi', workspaceSlug: workspace.slug },
        user,
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/organization/i);
    });
  });

  describe('Turn lifecycle', () => {
    it('creates a conversation, persists user + assistant rows, returns JSON', async () => {
      const { owner, workspace } = await setupOrgWorkspace();

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'The answer is 42.', toolCalls: [], toolResults: [] },
        ]) as any,
      );

      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        { message: 'What is the answer?', workspaceSlug: workspace.slug },
        owner,
      );

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(typeof data.conversationId).toBe('string');
      expect(Array.isArray(data.messages)).toBe(true);
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0]).toMatchObject({
        role: 'assistant',
        content: 'The answer is 42.',
      });

      // The assistant rows AND the user row land on the SharedConversation.
      const row = await db.sharedConversation.findUnique({
        where: { id: data.conversationId },
        select: { messages: true, sourceControlOrgId: true, userId: true },
      });
      expect(row?.userId).toBe(owner.id);
      const stored = row?.messages as Array<{ id: string; role: string; content: string }>;
      expect(stored.some((m) => m.role === 'user' && m.content === 'What is the answer?')).toBe(true);
      expect(stored.some((m) => m.role === 'assistant' && m.content === 'The answer is 42.')).toBe(true);
    });

    it('continues an existing conversation by id (history reconstruction)', async () => {
      const { owner, workspace } = await setupOrgWorkspace();

      // Turn 1
      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'First answer.', toolCalls: [], toolResults: [] },
        ]) as any,
      );
      const first = await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          { message: 'First question', workspaceSlug: workspace.slug },
          owner,
        ),
      );
      const { conversationId } = await first.json();

      // Turn 2 — same conversationId; the agent should see prior turns.
      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'Second answer.', toolCalls: [], toolResults: [] },
        ]) as any,
      );
      const second = await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          {
            message: 'Second question',
            conversationId,
            workspaceSlug: workspace.slug,
          },
          owner,
        ),
      );
      expect(second.status).toBe(200);
      const secondData = await second.json();
      expect(secondData.conversationId).toBe(conversationId);

      // The model messages on turn 2 include the reconstructed history.
      const callArgs = vi.mocked(streamText).mock.calls.at(-1)![0];
      const contents = (callArgs.messages ?? []).map((m: any) => m.content);
      expect(contents).toContain('First question');
      expect(contents).toContain('First answer.');
      expect(contents).toContain('Second question');
    });

    it('IDOR: a cross-user conversationId yields a fresh owned row, not the victim\'s', async () => {
      const { owner: victim, org, workspace } = await setupOrgWorkspace();

      // Victim's conversation with secret content.
      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([{ text: 'secret', toolCalls: [], toolResults: [] }]) as any,
      );
      const victimTurn = await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          { message: 'victim secret', workspaceSlug: workspace.slug },
          victim,
        ),
      );
      const victimConvId = (await victimTurn.json()).conversationId;

      // Attacker (a member) passes the victim's conversationId.
      const attacker = await createTestUser({
        email: generateUniqueId('attacker') + '@example.com',
        withGitHubAuth: true,
      });
      await db.workspaceMember.create({
        data: { userId: attacker.id, workspaceId: workspace.id, role: 'DEVELOPER' },
      });
      // Give the attacker their own org PAT so credential resolution
      // succeeds and the test isolates the IDOR (row-ownership) behavior.
      const attackerToken = encryptionService.encryptField(
        'source_control_token',
        'github_pat_attacker_token',
      );
      await db.sourceControlToken.create({
        data: {
          userId: attacker.id,
          sourceControlOrgId: org.id,
          token: JSON.stringify(attackerToken),
          scopes: ['repo'],
        },
      });

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([{ text: 'ok', toolCalls: [], toolResults: [] }]) as any,
      );
      const attackerTurn = await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          {
            message: 'give me the secret',
            conversationId: victimConvId,
            workspaceSlug: workspace.slug,
          },
          attacker,
        ),
      );
      expect(attackerTurn.status).toBe(200);
      const attackerData = await attackerTurn.json();

      // A NEW row was created for the attacker — not the victim's.
      expect(attackerData.conversationId).not.toBe(victimConvId);
      const callArgs = vi.mocked(streamText).mock.calls.at(-1)![0];
      const contents = (callArgs.messages ?? []).map((m: any) => m.content);
      expect(contents).not.toContain('victim secret');
    });
  });

  describe('API token auth', () => {
    it('accepts a valid x-api-token and acts as the workspace owner', async () => {
      const { owner, workspace } = await setupOrgWorkspace();

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'eval response', toolCalls: [], toolResults: [] },
        ]) as any,
      );

      const request = createRequestWithHeaders(
        '/api/ask/sync',
        'POST',
        {
          'Content-Type': 'application/json',
          'x-api-token': 'test-api-token',
        },
        { message: 'automated eval prompt', workspaceSlug: workspace.slug },
      );

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.messages[0].content).toBe('eval response');

      // The conversation row is owned by the workspace owner (the acting user).
      const row = await db.sharedConversation.findUnique({
        where: { id: data.conversationId },
        select: { userId: true },
      });
      expect(row?.userId).toBe(owner.id);
    });

    it('rejects an invalid x-api-token with no session (401)', async () => {
      const { workspace } = await setupOrgWorkspace();
      const request = createRequestWithHeaders(
        '/api/ask/sync',
        'POST',
        {
          'Content-Type': 'application/json',
          'x-api-token': 'wrong-token',
        },
        { message: 'hi', workspaceSlug: workspace.slug },
      );
      const response = await POST(request);
      expect(response.status).toBe(401);
    });
  });

  describe('dryRun (eval / replay)', () => {
    it('rejects messages[] replay mode without dryRun (400)', async () => {
      const { owner, workspace } = await setupOrgWorkspace();
      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        {
          messages: [{ role: 'user', content: 'replayed prompt' }],
          workspaceSlug: workspace.slug,
        },
        owner,
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toMatch(/dryRun/i);
    });

    it('dryRun + messages[] returns rows and persists NOTHING', async () => {
      const { owner, org, workspace } = await setupOrgWorkspace();

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'dry answer', toolCalls: [], toolResults: [] },
        ]) as any,
      );

      const request = createAuthenticatedPostRequest(
        '/api/ask/sync',
        {
          messages: [
            { role: 'user', content: 'First' },
            { role: 'assistant', content: 'Prior' },
            { role: 'user', content: 'Replay me' },
          ],
          workspaceSlug: workspace.slug,
          dryRun: true,
        },
        owner,
      );

      const response = await POST(request);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.dryRun).toBe(true);
      expect(data.conversationId).toBeNull();
      expect(data.messages[0].content).toBe('dry answer');

      // The transcript was passed verbatim to the agent.
      const callArgs = vi.mocked(streamText).mock.calls.at(-1)![0];
      const contents = (callArgs.messages ?? []).map((m: any) => m.content);
      expect(contents).toEqual(
        expect.arrayContaining(['First', 'Prior', 'Replay me']),
      );

      // No SharedConversation row was created for this org.
      const count = await db.sharedConversation.count({
        where: { sourceControlOrgId: org.id },
      });
      expect(count).toBe(0);
    });

    it('dryRun in server-history mode also persists nothing', async () => {
      const { owner, org, workspace } = await setupOrgWorkspace();

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'dry answer', toolCalls: [], toolResults: [] },
        ]) as any,
      );

      const response = await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          { message: 'preview this', workspaceSlug: workspace.slug, dryRun: true },
          owner,
        ),
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.dryRun).toBe(true);
      expect(data.conversationId).toBeNull();

      const count = await db.sharedConversation.count({
        where: { sourceControlOrgId: org.id },
      });
      expect(count).toBe(0);
    });

    it('dryRun composes a side-effect-free toolset: propose_* kept, mutators + planner stripped', async () => {
      const { owner, workspace } = await setupOrgWorkspace();

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([{ text: 'ok', toolCalls: [], toolResults: [] }]) as any,
      );

      await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          {
            messages: [{ role: 'user', content: 'propose a feature' }],
            workspaceSlug: workspace.slug,
            dryRun: true,
          },
          owner,
        ),
      );

      const callArgs = vi.mocked(streamText).mock.calls.at(-1)![0];
      const toolNames = Object.keys(callArgs.tools ?? {});

      // Pure-output proposal tools survive the readonly strip.
      expect(toolNames).toContain('propose_feature');
      // Genuinely-mutating tools are stripped...
      expect(toolNames).not.toContain('update_canvas');
      expect(toolNames).not.toContain('assign_feature_to_initiative');
      // ...and the planner capability (real Stakwork dispatch) is absent.
      expect(toolNames).not.toContain('send_to_feature_planner');
      // No deferred-check write tool injected.
      expect(toolNames).not.toContain('schedule_check');
    });
  });

  describe('maxTurns', () => {
    it('rejects a non-positive / non-integer maxTurns (400)', async () => {
      const { owner, workspace } = await setupOrgWorkspace();
      for (const bad of [0, -1, 2.5, 'three']) {
        const response = await POST(
          createAuthenticatedPostRequest(
            '/api/ask/sync',
            { message: 'hi', workspaceSlug: workspace.slug, maxTurns: bad },
            owner,
          ),
        );
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toMatch(/maxTurns/i);
      }
    });

    it('appends a step-cap stop condition when maxTurns is set', async () => {
      const { owner, workspace } = await setupOrgWorkspace();

      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([{ text: 'one step', toolCalls: [], toolResults: [] }]) as any,
      );

      // Without maxTurns: only the default end-marker stop condition.
      await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          { message: 'no cap', workspaceSlug: workspace.slug },
          owner,
        ),
      );
      const noCap = vi.mocked(streamText).mock.calls.at(-1)![0];
      expect(noCap.stopWhen).toHaveLength(1);

      // With maxTurns: the cap is appended (end-marker + step cap).
      await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          { message: 'capped', workspaceSlug: workspace.slug, maxTurns: 1 },
          owner,
        ),
      );
      const capped = vi.mocked(streamText).mock.calls.at(-1)![0];
      expect(capped.stopWhen).toHaveLength(2);
    });

    it('counts generated steps, not input messages (100 in, 1 step out)', async () => {
      const { owner, workspace } = await setupOrgWorkspace();

      // A big replayed transcript — these are CONTEXT, not steps.
      const transcript = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `msg ${i}`,
      }));

      // The agent generates exactly one step (what maxTurns:1 would yield).
      vi.mocked(streamText).mockReturnValue(
        mockFinishedStream([
          { text: 'the single next step', toolCalls: [], toolResults: [] },
        ]) as any,
      );

      const response = await POST(
        createAuthenticatedPostRequest(
          '/api/ask/sync',
          {
            messages: transcript,
            workspaceSlug: workspace.slug,
            dryRun: true,
            maxTurns: 1,
          },
          owner,
        ),
      );
      expect(response.status).toBe(200);
      const data = await response.json();

      // All 100 messages were fed to the model as context...
      const callArgs = vi.mocked(streamText).mock.calls.at(-1)![0];
      expect(callArgs.messages).toHaveLength(100);
      // ...but the response carries only the generated step(s), never the input.
      expect(data.messages).toHaveLength(1);
      expect(data.messages[0].content).toBe('the single next step');
    });
  });
});
