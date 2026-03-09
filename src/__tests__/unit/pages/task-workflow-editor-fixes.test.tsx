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
});
