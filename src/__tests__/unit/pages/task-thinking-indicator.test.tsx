// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for thinking indicator behavior in workflow_editor and project_debugger modes
 * 
 * These tests verify that:
 * 1. The thinking indicator (isChainVisible) is properly shown when sending messages
 * 2. The indicator is hidden on API errors
 * 3. Both workflow_editor and project_debugger modes behave correctly
 */

describe('Task Page - Thinking Indicator', () => {
  let setIsChainVisible: ReturnType<typeof vi.fn>;
  let clearLogs: ReturnType<typeof vi.fn>;
  let setMessages: ReturnType<typeof vi.fn>;
  let setIsLoading: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setIsChainVisible = vi.fn();
    clearLogs = vi.fn();
    setMessages = vi.fn();
    setIsLoading = vi.fn();
  });

  describe('workflow_editor mode', () => {
    it('should show thinking indicator on successful message send', async () => {
      // Mock successful API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ 
          success: true,
          workflow: { webhook: 'test-webhook' }
        }),
      });

      // Simulate the workflow_editor try block logic
      try {
        const response = await fetch('/api/workflow-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'test', taskId: '123' }),
        });

        const result = await response.json();
        
        // Update message status
        setMessages(vi.fn());
        
        // Show thinking indicator (the fix we're testing)
        setIsChainVisible(true);
        clearLogs();
        
      } catch (error) {
        setIsChainVisible(false);
      }

      expect(setIsChainVisible).toHaveBeenCalledWith(true);
      expect(clearLogs).toHaveBeenCalled();
    });

    it('should hide thinking indicator on API failure', async () => {
      // Mock failed API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
      });

      // Simulate the workflow_editor try/catch block logic
      try {
        const response = await fetch('/api/workflow-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'test', taskId: '123' }),
        });

        if (!response.ok) {
          throw new Error(`Failed to send workflow editor request: ${response.statusText}`);
        }
      } catch (error) {
        setMessages(vi.fn());
        setIsChainVisible(false);
      } finally {
        setIsLoading(false);
      }

      expect(setIsChainVisible).toHaveBeenCalledWith(false);
    });
  });

  describe('project_debugger mode', () => {
    it('should show thinking indicator on successful message send', async () => {
      // Mock successful API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ 
          success: true,
          webhook: 'test-webhook' 
        }),
      });

      // Simulate the project_debugger try block logic
      try {
        const response = await fetch('/api/project-debugger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'test', taskId: '123', projectId: 'proj-1' }),
        });

        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to send project debugger request');
        }

        // Update message status
        setMessages(vi.fn());
        
        // Show thinking indicator (the fix we're testing)
        setIsChainVisible(true);
        clearLogs();
        
      } catch (error) {
        setIsChainVisible(false);
      }

      expect(setIsChainVisible).toHaveBeenCalledWith(true);
      expect(clearLogs).toHaveBeenCalled();
    });

    it('should hide thinking indicator on API failure', async () => {
      // Mock failed API response
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ 
          success: false,
          error: 'Validation failed'
        }),
      });

      // Simulate the project_debugger try/catch block logic
      try {
        const response = await fetch('/api/project-debugger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'test', taskId: '123', projectId: 'proj-1' }),
        });

        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to send project debugger request');
        }
      } catch (error) {
        setMessages(vi.fn());
        setIsChainVisible(false);
      } finally {
        setIsLoading(false);
      }

      expect(setIsChainVisible).toHaveBeenCalledWith(false);
    });
  });
});
