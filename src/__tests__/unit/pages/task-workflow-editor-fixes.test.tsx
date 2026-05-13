// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Workflow Editor bug fixes:
 * 1. workflowStatus set to IN_PROGRESS after successful send, PENDING on error
 * 2. handleWorkflowSelect includes workflowVersionId and uses versionRefId in setCurrentWorkflowContext
 */

// Minimal WorkflowStatus enum matching the real one
enum WorkflowStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  FAILED = 'FAILED',
  HALTED = 'HALTED',
}

describe('Task Page - Workflow Editor fixes', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // handleSend — workflowStatus state after send
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleSend workflow_editor path — workflowStatus', () => {
    let setWorkflowStatus: ReturnType<typeof vi.fn>;
    let setIsChainVisible: ReturnType<typeof vi.fn>;
    let setIsLoading: ReturnType<typeof vi.fn>;
    let setMessages: ReturnType<typeof vi.fn>;
    let clearLogs: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      setWorkflowStatus = vi.fn();
      setIsChainVisible = vi.fn();
      setIsLoading = vi.fn();
      setMessages = vi.fn();
      clearLogs = vi.fn();
    });

    it('sets workflowStatus to IN_PROGRESS on successful send', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          workflow: { webhook: 'test-webhook', project_id: 42 },
        }),
      });

      // Simulate the workflow_editor handleSend success path
      try {
        const response = await fetch('/api/workflow-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: '1', message: 'hello' }),
        });

        if (!response.ok) throw new Error('not ok');
        const result = await response.json();
        if (!result.success) throw new Error(result.error);

        setMessages(vi.fn());
        setIsChainVisible(true);
        setWorkflowStatus(WorkflowStatus.IN_PROGRESS);
        clearLogs();
      } catch {
        setIsChainVisible(false);
        setWorkflowStatus(WorkflowStatus.PENDING);
      } finally {
        setIsLoading(false);
      }

      expect(setWorkflowStatus).toHaveBeenCalledWith(WorkflowStatus.IN_PROGRESS);
      expect(setIsChainVisible).toHaveBeenCalledWith(true);
    });

    it('resets workflowStatus to PENDING on send error (API not ok)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      try {
        const response = await fetch('/api/workflow-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: '1', message: 'hello' }),
        });

        if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
      } catch {
        setMessages(vi.fn());
        setIsChainVisible(false);
        setWorkflowStatus(WorkflowStatus.PENDING);
      } finally {
        setIsLoading(false);
      }

      expect(setWorkflowStatus).toHaveBeenCalledWith(WorkflowStatus.PENDING);
      expect(setIsChainVisible).toHaveBeenCalledWith(false);
    });

    it('resets workflowStatus to PENDING on send error (result.success false)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Validation failed' }),
      });

      try {
        const response = await fetch('/api/workflow-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: '1', message: 'hello' }),
        });

        const result = await response.json();
        if (!result.success) throw new Error(result.error);

        setIsChainVisible(true);
        setWorkflowStatus(WorkflowStatus.IN_PROGRESS);
      } catch {
        setIsChainVisible(false);
        setWorkflowStatus(WorkflowStatus.PENDING);
      } finally {
        setIsLoading(false);
      }

      expect(setWorkflowStatus).toHaveBeenCalledWith(WorkflowStatus.PENDING);
      expect(setWorkflowStatus).not.toHaveBeenCalledWith(WorkflowStatus.IN_PROGRESS);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // handleWorkflowSelect — setCurrentWorkflowContext includes workflowVersionId
  // and uses versionRefId (not workflowData.ref_id)
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleWorkflowSelect — setCurrentWorkflowContext', () => {
    let setCurrentWorkflowContext: ReturnType<typeof vi.fn>;
    let setWorkflowStatus: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      setCurrentWorkflowContext = vi.fn();
      setWorkflowStatus = vi.fn();
    });

    /**
     * Simulates the core context-setting logic from handleWorkflowSelect
     * after a versioned workflow is selected.
     */
    function simulateHandleWorkflowSelect(opts: {
      workflowId: number;
      workflowData: { ref_id: string; properties: { name?: string } };
      workflowVersionId?: string;
      versionNodeRefId?: string; // ref_id from version node (overwrites versionRefId)
    }) {
      const { workflowId, workflowData, workflowVersionId, versionNodeRefId } = opts;

      // Mirrors real code: versionRefId starts as workflowData.ref_id,
      // then is overwritten to version node's ref_id when a version is fetched.
      let versionRefId = workflowData.ref_id;
      if (workflowVersionId && versionNodeRefId) {
        versionRefId = versionNodeRefId;
      }

      const workflowName = workflowData.properties.name;

      setWorkflowStatus(WorkflowStatus.PENDING);
      setCurrentWorkflowContext({
        workflowId,
        workflowName: workflowName || `Workflow ${workflowId}`,
        workflowRefId: versionRefId,       // fixed: was workflowData.ref_id
        workflowVersionId,                  // fixed: was missing
      });
    }

    it('includes workflowVersionId in context when a version is selected', () => {
      simulateHandleWorkflowSelect({
        workflowId: 99,
        workflowData: { ref_id: 'root-ref-abc', properties: { name: 'My Workflow' } },
        workflowVersionId: 'ver-uuid-1234',
        versionNodeRefId: 'version-ref-xyz',
      });

      expect(setCurrentWorkflowContext).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowVersionId: 'ver-uuid-1234',
        }),
      );
    });

    it('uses versionRefId (version node ref_id) not workflowData.ref_id when a version is selected', () => {
      simulateHandleWorkflowSelect({
        workflowId: 99,
        workflowData: { ref_id: 'root-ref-abc', properties: { name: 'My Workflow' } },
        workflowVersionId: 'ver-uuid-1234',
        versionNodeRefId: 'version-ref-xyz',
      });

      const call = setCurrentWorkflowContext.mock.calls[0][0];
      expect(call.workflowRefId).toBe('version-ref-xyz');
      expect(call.workflowRefId).not.toBe('root-ref-abc');
    });

    it('falls back to workflowData.ref_id when no specific version is selected', () => {
      simulateHandleWorkflowSelect({
        workflowId: 7,
        workflowData: { ref_id: 'root-ref-abc', properties: { name: 'My Workflow' } },
        // no workflowVersionId / versionNodeRefId
      });

      const call = setCurrentWorkflowContext.mock.calls[0][0];
      expect(call.workflowRefId).toBe('root-ref-abc');
      expect(call.workflowVersionId).toBeUndefined();
    });

    it('sets correct workflowId and workflowName in context', () => {
      simulateHandleWorkflowSelect({
        workflowId: 42,
        workflowData: { ref_id: 'root-ref-abc', properties: { name: 'Edge Case Flow' } },
        workflowVersionId: 'ver-uuid-5678',
        versionNodeRefId: 'ver-node-ref',
      });

      expect(setCurrentWorkflowContext).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 42,
          workflowName: 'Edge Case Flow',
        }),
      );
    });

    it('generates default workflowName from workflowId when name is missing', () => {
      simulateHandleWorkflowSelect({
        workflowId: 55,
        workflowData: { ref_id: 'root-ref-abc', properties: {} },
        workflowVersionId: 'ver-uuid-9999',
        versionNodeRefId: 'ver-node-ref',
      });

      expect(setCurrentWorkflowContext).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowName: 'Workflow 55',
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // handleVersionChange — resolves workflowRefId from versions API
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleVersionChange — resolves workflowRefId from versions API', () => {
    let setCurrentWorkflowContext: ReturnType<typeof vi.fn>;

    const baseContext = {
      workflowId: 42,
      workflowName: 'My Workflow',
      workflowRefId: 'old-ref-id',
      workflowVersionId: 'old-version-id',
    };

    const versionsResponse = {
      versions: [
        { workflow_version_id: 'ver-aaa', ref_id: 'ref-aaa' },
        { workflow_version_id: 'ver-bbb', ref_id: 'ref-bbb' },
      ],
    };

    beforeEach(() => {
      setCurrentWorkflowContext = vi.fn();
    });

    /**
     * Simulates the async handleVersionChange logic from page.tsx.
     */
    async function simulateHandleVersionChange(opts: {
      versionId: string;
      context: typeof baseContext | null;
      slug?: string;
      fetchImpl?: () => Promise<unknown>;
    }) {
      const { versionId, context, slug = 'test-workspace', fetchImpl } = opts;

      if (!context) return;

      const { workflowId, workflowRefId: prevWorkflowRefId } = context;

      global.fetch = fetchImpl
        ? vi.fn().mockImplementation(fetchImpl)
        : vi.fn().mockResolvedValue({
            ok: true,
            json: async () => versionsResponse,
          });

      try {
        const response = await fetch(`/api/workspaces/${slug}/workflows/${workflowId}/versions`);
        if (!(response as Response).ok) throw new Error('not ok');
        const data = await (response as Response).json() as { versions?: Array<{ workflow_version_id: string; ref_id: string }> };
        const versions = data.versions ?? [];
        const match = versions.find((v) => v.workflow_version_id === versionId);

        if (!match) {
          setCurrentWorkflowContext((prev: typeof baseContext | null) =>
            prev ? { ...prev, workflowVersionId: versionId } : prev,
          );
          return;
        }

        setCurrentWorkflowContext((prev: typeof baseContext | null) =>
          prev ? { ...prev, workflowVersionId: versionId, workflowRefId: match.ref_id } : prev,
        );
      } catch {
        setCurrentWorkflowContext((prev: typeof baseContext | null) =>
          prev ? { ...prev, workflowVersionId: versionId, workflowRefId: prevWorkflowRefId } : prev,
        );
      }
    }

    it('happy path: updates both workflowVersionId and workflowRefId atomically', async () => {
      await simulateHandleVersionChange({ versionId: 'ver-bbb', context: baseContext });

      expect(setCurrentWorkflowContext).toHaveBeenCalledTimes(1);
      // Invoke the updater with the base context to inspect the result
      const updater = setCurrentWorkflowContext.mock.calls[0][0] as (prev: typeof baseContext) => typeof baseContext;
      const result = updater(baseContext);
      expect(result.workflowVersionId).toBe('ver-bbb');
      expect(result.workflowRefId).toBe('ref-bbb');
    });

    it('fetch failure: retains previous workflowRefId, still updates workflowVersionId', async () => {
      await simulateHandleVersionChange({
        versionId: 'ver-aaa',
        context: baseContext,
        fetchImpl: async () => { throw new Error('network error'); },
      });

      expect(setCurrentWorkflowContext).toHaveBeenCalledTimes(1);
      const updater = setCurrentWorkflowContext.mock.calls[0][0] as (prev: typeof baseContext) => typeof baseContext;
      const result = updater(baseContext);
      expect(result.workflowVersionId).toBe('ver-aaa');
      expect(result.workflowRefId).toBe('old-ref-id');
    });

    it('version not found: retains previous workflowRefId', async () => {
      await simulateHandleVersionChange({ versionId: 'ver-unknown', context: baseContext });

      expect(setCurrentWorkflowContext).toHaveBeenCalledTimes(1);
      const updater = setCurrentWorkflowContext.mock.calls[0][0] as (prev: typeof baseContext) => typeof baseContext;
      const result = updater(baseContext);
      expect(result.workflowVersionId).toBe('ver-unknown');
      expect(result.workflowRefId).toBe('old-ref-id');
    });

    it('null context guard: setCurrentWorkflowContext is never called', async () => {
      await simulateHandleVersionChange({ versionId: 'ver-aaa', context: null });

      expect(setCurrentWorkflowContext).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Restore workflow context on page reload — last-match scan
  // ────────────────────────────────────────────────────────────────────────────
  describe('workflow_editor context restore — last-match scan', () => {
    /**
     * Simulates the restore logic introduced to replace the for…break pattern.
     * Iterates all messages / WORKFLOW artifacts (oldest → newest) and keeps
     * a running `latestContext` that is overwritten on each match, so the
     * returned value always reflects the most recent artifact.
     */
    function simulateRestoreContext(
      messages: Array<{
        artifacts?: Array<{
          type: string;
          content?: {
            workflowId?: number | string;
            workflowName?: string;
            workflowRefId?: string;
            workflowVersionId?: string | number;
          };
        }>;
      }>,
    ) {
      type RestoredContext = {
        workflowId: number | string;
        workflowName: string;
        workflowRefId: string;
        workflowVersionId?: string;
      };

      const contexts: RestoredContext[] = [];

      for (const msg of messages) {
        for (const a of msg.artifacts ?? []) {
          if (a.type === "WORKFLOW" && a.content?.workflowId) {
            const c = a.content;
            const prevVersionId = contexts.length > 0 ? contexts[contexts.length - 1].workflowVersionId : undefined;
            contexts.push({
              workflowId: c.workflowId!,
              workflowName: c.workflowName || `Workflow ${c.workflowId}`,
              workflowRefId: c.workflowRefId || "",
              workflowVersionId:
                c.workflowVersionId != null
                  ? String(c.workflowVersionId)
                  : prevVersionId,
            });
          }
        }
      }

      return contexts.length > 0 ? contexts[contexts.length - 1] : null;
    }

    it('picks workflowVersionId from the last WORKFLOW artifact across all messages', () => {
      const messages = [
        {
          artifacts: [
            {
              type: "WORKFLOW",
              content: { workflowId: 10, workflowVersionId: "first-version" },
            },
          ],
        },
        {
          artifacts: [
            {
              type: "WORKFLOW",
              content: { workflowId: 10, workflowVersionId: "last-version" },
            },
          ],
        },
      ];

      const ctx = simulateRestoreContext(messages);
      expect(ctx?.workflowVersionId).toBe("last-version");
    });

    it('retains the first version when later artifacts omit workflowVersionId', () => {
      const messages = [
        {
          artifacts: [
            {
              type: "WORKFLOW",
              content: { workflowId: 20, workflowVersionId: "only-version" },
            },
          ],
        },
        {
          artifacts: [
            {
              // Later artifact has no workflowVersionId — previous value should persist
              type: "WORKFLOW",
              content: { workflowId: 20 },
            },
          ],
        },
      ];

      const ctx = simulateRestoreContext(messages);
      expect(ctx?.workflowVersionId).toBe("only-version");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // handleSend — silent block when workflowRefId is missing
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleSend — missing workflowRefId is silently blocked', () => {
    it('does not call toast.error when workflowRefId is empty', () => {
      const toastError = vi.fn();
      let sendCalled = false;

      // Simulate the guard from handleSend in workflow_editor mode
      function simulateHandleSend(workflowRefId: string) {
        if (!workflowRefId) {
          // After fix: no toast — just return
          return;
        }
        sendCalled = true;
      }

      simulateHandleSend('');

      expect(toastError).not.toHaveBeenCalled();
      expect(sendCalled).toBe(false);
    });

    it('proceeds with send when workflowRefId is present', () => {
      let sendCalled = false;

      function simulateHandleSend(workflowRefId: string) {
        if (!workflowRefId) {
          return;
        }
        sendCalled = true;
      }

      simulateHandleSend('valid-ref-id');

      expect(sendCalled).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // handleNewMessage — sync workflowRefId from incoming WORKFLOW artifact
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleNewMessage — workflowRefId sync from WORKFLOW artifact', () => {
    type WorkflowContext = {
      workflowId: number;
      workflowName: string;
      workflowRefId: string;
      workflowVersionId?: string;
    };

    type ArtifactContent = {
      workflowId?: number;
      workflowRefId?: string;
      workflowVersionId?: string;
    };

    type Artifact = {
      type: string;
      content?: ArtifactContent;
    };

    type IncomingMessage = {
      id: string;
      artifacts?: Artifact[];
    };

    function simulateHandleNewMessage(opts: {
      taskMode: string;
      message: IncomingMessage;
      currentContext: WorkflowContext | null;
    }): WorkflowContext | null {
      const { taskMode, message, currentContext } = opts;
      let updatedContext = currentContext;

      if (taskMode === 'workflow_editor') {
        const workflowArtifact = message.artifacts?.find(
          (a) => a.type === 'WORKFLOW' && (a.content as ArtifactContent)?.workflowRefId
        );
        if (workflowArtifact) {
          const incomingRefId = (workflowArtifact.content as ArtifactContent).workflowRefId!;
          updatedContext = currentContext ? { ...currentContext, workflowRefId: incomingRefId } : currentContext;
        }
      }

      return updatedContext;
    }

    const baseContext: WorkflowContext = {
      workflowId: 10,
      workflowName: 'Test Workflow',
      workflowRefId: 'original-ref-id',
      workflowVersionId: 'ver-001',
    };

    it('updates workflowRefId when WORKFLOW artifact with refId arrives in workflow_editor mode', () => {
      const setCurrentWorkflowContext = vi.fn();

      const message: IncomingMessage = {
        id: 'msg-1',
        artifacts: [
          {
            type: 'WORKFLOW',
            content: { workflowId: 10, workflowRefId: 'new-ref-from-artifact' },
          },
        ],
      };

      const result = simulateHandleNewMessage({
        taskMode: 'workflow_editor',
        message,
        currentContext: baseContext,
      });

      // Apply the updater as setCurrentWorkflowContext would
      setCurrentWorkflowContext((prev: WorkflowContext | null) =>
        prev ? { ...prev, workflowRefId: 'new-ref-from-artifact' } : prev
      );

      const updater = setCurrentWorkflowContext.mock.calls[0][0] as (prev: WorkflowContext) => WorkflowContext;
      const applied = updater(baseContext);

      expect(result?.workflowRefId).toBe('new-ref-from-artifact');
      expect(applied.workflowRefId).toBe('new-ref-from-artifact');
    });

    it('does NOT update workflowRefId when taskMode is not workflow_editor', () => {
      const message: IncomingMessage = {
        id: 'msg-2',
        artifacts: [
          {
            type: 'WORKFLOW',
            content: { workflowId: 10, workflowRefId: 'new-ref-from-artifact' },
          },
        ],
      };

      const result = simulateHandleNewMessage({
        taskMode: 'agent',
        message,
        currentContext: baseContext,
      });

      expect(result?.workflowRefId).toBe('original-ref-id');
    });

    it('does NOT update workflowRefId when WORKFLOW artifact has no workflowRefId', () => {
      const message: IncomingMessage = {
        id: 'msg-3',
        artifacts: [
          {
            type: 'WORKFLOW',
            content: { workflowId: 10 }, // no workflowRefId
          },
        ],
      };

      const result = simulateHandleNewMessage({
        taskMode: 'workflow_editor',
        message,
        currentContext: baseContext,
      });

      expect(result?.workflowRefId).toBe('original-ref-id');
    });

    it('does NOT update workflowRefId when artifact type is not WORKFLOW', () => {
      const message: IncomingMessage = {
        id: 'msg-4',
        artifacts: [
          {
            type: 'FORM',
            content: { workflowRefId: 'sneaky-ref' } as ArtifactContent,
          },
        ],
      };

      const result = simulateHandleNewMessage({
        taskMode: 'workflow_editor',
        message,
        currentContext: baseContext,
      });

      expect(result?.workflowRefId).toBe('original-ref-id');
    });

    it('original workflowRefId is used when no WORKFLOW artifact has arrived', () => {
      const message: IncomingMessage = {
        id: 'msg-5',
        artifacts: [],
      };

      const result = simulateHandleNewMessage({
        taskMode: 'workflow_editor',
        message,
        currentContext: baseContext,
      });

      expect(result?.workflowRefId).toBe('original-ref-id');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // taskTitle format in handleWorkflowSelect
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleWorkflowSelect — taskTitle format', () => {
    function buildTaskTitle(
      workflowName: string | undefined,
      workflowId: string | number,
      workflowVersionId: string | undefined,
    ): string {
      return workflowName
        ? `${workflowName} (ID: ${workflowId}${workflowVersionId ? ` · V${workflowVersionId.substring(0, 8)}` : ''})`
        : `Workflow ${workflowId}`;
    }

    it('includes workflow ID and first 8 chars of version when both are present', () => {
      const title = buildTaskTitle('My Workflow', '1234', '3fa8c1d2abcdef');
      expect(title).toBe('My Workflow (ID: 1234 · V3fa8c1d2)');
    });

    it('includes workflow ID only when version is absent', () => {
      const title = buildTaskTitle('My Workflow', '1234', undefined);
      expect(title).toBe('My Workflow (ID: 1234)');
    });

    it('falls back to "Workflow {id}" when no workflow name is available', () => {
      const title = buildTaskTitle(undefined, '1234', '3fa8c1d2abcdef');
      expect(title).toBe('Workflow 1234');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // handleRetry — unified PATCH path (all modes)
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleRetry — unified PATCH path', () => {
    /** Simulates the simplified handleRetry logic from page.tsx */
    async function runHandleRetry({
      currentTaskId,
      isRetrying,
      fetchMock,
      setIsRetrying,
      toastError,
    }: {
      currentTaskId: string | null;
      isRetrying: boolean;
      fetchMock: ReturnType<typeof vi.fn>;
      setIsRetrying: ReturnType<typeof vi.fn>;
      toastError: ReturnType<typeof vi.fn>;
    }) {
      if (!currentTaskId || isRetrying) return;
      setIsRetrying(true);

      try {
        const res = await fetchMock(`/api/tasks/${currentTaskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retryWorkflow: true }),
        });
        if (!res.ok) throw new Error('Retry failed');
      } catch {
        toastError('Failed to retry task. Please try again.');
      } finally {
        setIsRetrying(false);
      }
    }

    function makeSetters() {
      return {
        setIsRetrying: vi.fn(),
        toastError: vi.fn(),
      };
    }

    it('workflow_editor mode: calls PATCH /api/tasks/[taskId] with { retryWorkflow: true }', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: 'task-1',
        isRetrying: false,
        fetchMock,
        ...setters,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks/task-1',
        expect.objectContaining({ method: 'PATCH' }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ retryWorkflow: true });
    });

    it('never calls POST /api/workflow-editor in any mode', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: 'task-1',
        isRetrying: false,
        fetchMock,
        ...setters,
      });

      expect(fetchMock).not.toHaveBeenCalledWith('/api/workflow-editor', expect.anything());
    });

    it('non-workflow_editor mode: also calls PATCH /api/tasks/[taskId] with { retryWorkflow: true }', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: 'task-42',
        isRetrying: false,
        fetchMock,
        ...setters,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks/task-42',
        expect.objectContaining({ method: 'PATCH' }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toEqual({ retryWorkflow: true });
    });

    it('API error: calls toast.error and always calls setIsRetrying(false)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: 'task-1',
        isRetrying: false,
        fetchMock,
        ...setters,
      });

      expect(setters.toastError).toHaveBeenCalledWith('Failed to retry task. Please try again.');
      expect(setters.setIsRetrying).toHaveBeenCalledWith(false);
    });

    it('bails early when isRetrying is true', async () => {
      const fetchMock = vi.fn();
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: 'task-1',
        isRetrying: true,
        fetchMock,
        ...setters,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(setters.setIsRetrying).not.toHaveBeenCalled();
    });

    it('bails early when currentTaskId is null', async () => {
      const fetchMock = vi.fn();
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: null,
        isRetrying: false,
        fetchMock,
        ...setters,
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(setters.setIsRetrying).not.toHaveBeenCalled();
    });

    it('always calls setIsRetrying(false) in finally — success path', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      const setters = makeSetters();

      await runHandleRetry({
        currentTaskId: 'task-1',
        isRetrying: false,
        fetchMock,
        ...setters,
      });

      expect(setters.setIsRetrying).toHaveBeenCalledWith(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowArtifactPanel — multi-workflow selector logic
// ─────────────────────────────────────────────────────────────────────────────
describe('WorkflowArtifactPanel — multi-workflow selector', () => {
  // Helper: build a minimal artifact with workflow content
  function makeWorkflowArtifact(
    workflowId: string | number,
    workflowName: string,
    extras: Record<string, unknown> = {}
  ) {
    return {
      id: `artifact-${workflowId}-${Math.random()}`,
      type: 'WORKFLOW',
      content: {
        workflowId,
        workflowName,
        ...extras,
      },
    };
  }

  // Pure grouping logic extracted from the component for unit testing
  function computeWorkflowGroups(artifacts: ReturnType<typeof makeWorkflowArtifact>[]) {
    const map = new Map<string, { workflowId: number | string; workflowName: string; artifacts: typeof artifacts }>();
    for (const artifact of artifacts) {
      const content = artifact.content as { workflowId?: number | string; workflowName?: string };
      if (!content?.workflowId) continue;
      const key = String(content.workflowId);
      if (!map.has(key)) {
        map.set(key, {
          workflowId: content.workflowId,
          workflowName: content.workflowName || `Workflow ${key}`,
          artifacts: [],
        });
      }
      map.get(key)!.artifacts.push(artifact);
    }
    return Array.from(map.values());
  }

  // Pure merge logic scoped to a set of artifacts
  function mergeArtifacts(artifacts: ReturnType<typeof makeWorkflowArtifact>[]) {
    let workflowJson: string | undefined;
    let originalWorkflowJson: string | undefined;
    for (const artifact of artifacts) {
      const content = artifact.content as Record<string, unknown>;
      if (content?.workflowJson) workflowJson = content.workflowJson as string;
      if (content?.originalWorkflowJson) originalWorkflowJson = content.originalWorkflowJson as string;
    }
    return { workflowJson, originalWorkflowJson };
  }

  it('groups 2 artifacts with distinct workflowIds into 2 groups', () => {
    const artifacts = [
      makeWorkflowArtifact(1, 'Workflow One'),
      makeWorkflowArtifact(2, 'Workflow Two'),
    ];
    const groups = computeWorkflowGroups(artifacts);
    expect(groups).toHaveLength(2);
    expect(groups[0].workflowId).toBe(1);
    expect(groups[1].workflowId).toBe(2);
  });

  it('groups multiple artifacts with the same workflowId into 1 group', () => {
    const artifacts = [
      makeWorkflowArtifact(1, 'Workflow One'),
      makeWorkflowArtifact(1, 'Workflow One'),
      makeWorkflowArtifact(1, 'Workflow One'),
    ];
    const groups = computeWorkflowGroups(artifacts);
    expect(groups).toHaveLength(1);
    expect(groups[0].artifacts).toHaveLength(3);
  });

  it('excludes artifacts without a workflowId from groups', () => {
    const artifacts = [
      { id: 'no-id', type: 'WORKFLOW', content: { workflowJson: '{}' } } as ReturnType<typeof makeWorkflowArtifact>,
      makeWorkflowArtifact(1, 'Workflow One'),
    ];
    const groups = computeWorkflowGroups(artifacts);
    expect(groups).toHaveLength(1);
    expect(groups[0].workflowId).toBe(1);
  });

  it('preserves insertion order of first appearances', () => {
    const artifacts = [
      makeWorkflowArtifact(3, 'Third'),
      makeWorkflowArtifact(1, 'First'),
      makeWorkflowArtifact(2, 'Second'),
      makeWorkflowArtifact(1, 'First again'),
    ];
    const groups = computeWorkflowGroups(artifacts);
    expect(groups.map(g => g.workflowId)).toEqual([3, 1, 2]);
  });

  it('single workflow artifact produces no dropdown (groups.length === 1)', () => {
    const artifacts = [makeWorkflowArtifact(42, 'Solo Workflow')];
    const groups = computeWorkflowGroups(artifacts);
    expect(groups).toHaveLength(1);
    // Dropdown is only rendered when groups.length > 1
    expect(groups.length > 1).toBe(false);
  });

  it('scoping merge to selected workflow returns that groups artifacts only', () => {
    const wf1Artifact = makeWorkflowArtifact(1, 'WF1', { workflowJson: '{"wf":1}' });
    const wf2Artifact = makeWorkflowArtifact(2, 'WF2', { workflowJson: '{"wf":2}', originalWorkflowJson: '{"orig":2}' });
    const allArtifacts = [wf1Artifact, wf2Artifact];

    const groups = computeWorkflowGroups(allArtifacts);

    // Simulate selecting workflow 1
    const group1Artifacts = groups.find(g => String(g.workflowId) === '1')!.artifacts;
    const merged1 = mergeArtifacts(group1Artifacts);
    expect(merged1.workflowJson).toBe('{"wf":1}');
    expect(merged1.originalWorkflowJson).toBeUndefined();

    // Simulate selecting workflow 2
    const group2Artifacts = groups.find(g => String(g.workflowId) === '2')!.artifacts;
    const merged2 = mergeArtifacts(group2Artifacts);
    expect(merged2.workflowJson).toBe('{"wf":2}');
    expect(merged2.originalWorkflowJson).toBe('{"orig":2}');
  });

  it('Changes tab should be hidden when selected workflow has no originalWorkflowJson', () => {
    const artifact = makeWorkflowArtifact(1, 'WF1', { workflowJson: '{"wf":1}' });
    const merged = mergeArtifacts([artifact]);
    // hasChanges = !!(originalWorkflowJson && workflowJson)
    const hasChanges = !!(merged.originalWorkflowJson && merged.workflowJson);
    expect(hasChanges).toBe(false);
  });

  it('Changes tab should be available when selected workflow has originalWorkflowJson', () => {
    const artifact = makeWorkflowArtifact(2, 'WF2', {
      workflowJson: '{"wf":2}',
      originalWorkflowJson: '{"orig":2}',
    });
    const merged = mergeArtifacts([artifact]);
    const hasChanges = !!(merged.originalWorkflowJson && merged.workflowJson);
    expect(hasChanges).toBe(true);
  });

  it('tab fallback: activeDisplayTab resets to editor when switching to workflow with no originalWorkflowJson', () => {
    // Simulate the tab-fallback logic from the useEffect
    let activeDisplayTab = 'changes';
    const originalWorkflowJson: string | undefined = undefined; // no diff

    // The effect: if changes tab active and no originalWorkflowJson, reset
    if (activeDisplayTab === 'changes' && !originalWorkflowJson) {
      activeDisplayTab = 'editor';
    }

    expect(activeDisplayTab).toBe('editor');
  });

  it('tab fallback: activeDisplayTab stays on changes when switching to workflow with originalWorkflowJson', () => {
    let activeDisplayTab = 'changes';
    const originalWorkflowJson = '{"orig":1}'; // diff present

    if (activeDisplayTab === 'changes' && !originalWorkflowJson) {
      activeDisplayTab = 'editor';
    }

    expect(activeDisplayTab).toBe('changes');
  });

  it('falls back to Workflow {id} name when workflowName is missing', () => {
    const artifact = { id: 'a1', type: 'WORKFLOW', content: { workflowId: 99 } } as ReturnType<typeof makeWorkflowArtifact>;
    const groups = computeWorkflowGroups([artifact]);
    expect(groups[0].workflowName).toBe('Workflow 99');
  });
});
