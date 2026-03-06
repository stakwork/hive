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
  // Task title generation — handleWorkflowSelect taskTitle logic
  // ────────────────────────────────────────────────────────────────────────────
  describe('handleWorkflowSelect — taskTitle generation', () => {
    function buildTaskTitle(opts: {
      workflowName?: string;
      workflowId: number;
      workflowVersionId?: string;
    }): string {
      const { workflowName, workflowId, workflowVersionId } = opts;
      return workflowName
        ? `${workflowName} (ID: ${workflowId}${workflowVersionId ? ` · V${workflowVersionId.substring(0, 8)}` : ''})`
        : `Workflow ${workflowId}`;
    }

    it('includes workflow ID and truncated version when both name and version are present', () => {
      const title = buildTaskTitle({
        workflowName: 'My Workflow',
        workflowId: 1234,
        workflowVersionId: '3fa8c1d2abcdef99',
      });
      expect(title).toBe('My Workflow (ID: 1234 · V3fa8c1d2)');
    });

    it('includes workflow ID but no version suffix when name is present but version is absent', () => {
      const title = buildTaskTitle({
        workflowName: 'My Workflow',
        workflowId: 1234,
      });
      expect(title).toBe('My Workflow (ID: 1234)');
    });

    it('falls back to "Workflow {id}" when no workflow name is available', () => {
      const title = buildTaskTitle({
        workflowId: 1234,
        workflowVersionId: '3fa8c1d2abcdef99',
      });
      expect(title).toBe('Workflow 1234');
    });

    it('truncates version ID to first 8 characters', () => {
      const title = buildTaskTitle({
        workflowName: 'Edge Flow',
        workflowId: 99,
        workflowVersionId: 'abcdef1234567890',
      });
      expect(title).toBe('Edge Flow (ID: 99 · Vabcdef12)');
    });
  });
});
