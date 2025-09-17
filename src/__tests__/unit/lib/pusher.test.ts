import { describe, it, expect } from 'vitest';
import { getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from '@/lib/pusher';

describe('Pusher Utilities', () => {
  describe('Channel Naming', () => {
    it('should generate correct task channel names', () => {
      expect(getTaskChannelName('task-123')).toBe('task-task-123');
      expect(getTaskChannelName('abc-def-ghi')).toBe('task-abc-def-ghi');
      expect(getTaskChannelName('')).toBe('task-');
    });

    it('should generate correct workspace channel names', () => {
      expect(getWorkspaceChannelName('my-workspace')).toBe('workspace-my-workspace');
      expect(getWorkspaceChannelName('test')).toBe('workspace-test');
      expect(getWorkspaceChannelName('')).toBe('workspace-');
    });

    it('should handle special characters in channel names', () => {
      expect(getTaskChannelName('task-with-special_chars.123')).toBe('task-task-with-special_chars.123');
      expect(getWorkspaceChannelName('workspace-with-dashes_and.dots')).toBe('workspace-workspace-with-dashes_and.dots');
    });
  });

  describe('Event Constants', () => {
    it('should have all required event constants', () => {
      expect(PUSHER_EVENTS.NEW_MESSAGE).toBe('new-message');
      expect(PUSHER_EVENTS.CONNECTION_COUNT).toBe('connection-count');
      expect(PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE).toBe('workflow-status-update');
      expect(PUSHER_EVENTS.RECOMMENDATIONS_UPDATED).toBe('recommendations-updated');
      expect(PUSHER_EVENTS.TASK_TITLE_UPDATE).toBe('task-title-update');
      expect(PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE).toBe('workspace-task-title-update');
    });

    it('should have consistent event naming convention', () => {
      const events = Object.values(PUSHER_EVENTS);
      
      // All events should be kebab-case
      events.forEach(event => {
        expect(event).toMatch(/^[a-z]+(-[a-z]+)*$/);
      });
    });

    it('should have unique event names', () => {
      const events = Object.values(PUSHER_EVENTS);
      const uniqueEvents = new Set(events);
      
      expect(uniqueEvents.size).toBe(events.length);
    });
  });

  describe('Channel Name Consistency', () => {
    it('should maintain consistent channel naming patterns', () => {
      const taskId = 'test-task-123';
      const workspaceSlug = 'test-workspace';

      const taskChannel = getTaskChannelName(taskId);
      const workspaceChannel = getWorkspaceChannelName(workspaceSlug);

      // Channels should follow predictable patterns
      expect(taskChannel).toMatch(/^task-/);
      expect(workspaceChannel).toMatch(/^workspace-/);

      // Should be deterministic
      expect(getTaskChannelName(taskId)).toBe(taskChannel);
      expect(getWorkspaceChannelName(workspaceSlug)).toBe(workspaceChannel);
    });

    it('should handle edge cases in channel naming', () => {
      // Empty strings
      expect(getTaskChannelName('')).toBe('task-');
      expect(getWorkspaceChannelName('')).toBe('workspace-');

      // Very long identifiers
      const longId = 'a'.repeat(100);
      expect(getTaskChannelName(longId)).toBe(`task-${longId}`);

      // Numbers and special characters
      expect(getTaskChannelName('123')).toBe('task-123');
      expect(getTaskChannelName('test_id.with-chars')).toBe('task-test_id.with-chars');
    });
  });
});