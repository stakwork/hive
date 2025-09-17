import { describe, it, expect } from 'vitest';
import { mapStakworkStatus } from '@/utils/conversions';
import { WorkflowStatus } from '@prisma/client';

describe('Status Mapping Functions', () => {
  describe('mapStakworkStatus', () => {
    it('should map in_progress status correctly', () => {
      expect(mapStakworkStatus('in_progress')).toBe(WorkflowStatus.IN_PROGRESS);
      expect(mapStakworkStatus('IN_PROGRESS')).toBe(WorkflowStatus.IN_PROGRESS);
      expect(mapStakworkStatus('running')).toBe(WorkflowStatus.IN_PROGRESS);
      expect(mapStakworkStatus('processing')).toBe(WorkflowStatus.IN_PROGRESS);
    });

    it('should map completed status correctly', () => {
      expect(mapStakworkStatus('completed')).toBe(WorkflowStatus.COMPLETED);
      expect(mapStakworkStatus('COMPLETED')).toBe(WorkflowStatus.COMPLETED);
      expect(mapStakworkStatus('success')).toBe(WorkflowStatus.COMPLETED);
      expect(mapStakworkStatus('finished')).toBe(WorkflowStatus.COMPLETED);
    });

    it('should map failed status correctly', () => {
      expect(mapStakworkStatus('error')).toBe(WorkflowStatus.FAILED);
      expect(mapStakworkStatus('failed')).toBe(WorkflowStatus.FAILED);
      expect(mapStakworkStatus('ERROR')).toBe(WorkflowStatus.FAILED);
    });

    it('should map halted status correctly', () => {
      expect(mapStakworkStatus('halted')).toBe(WorkflowStatus.HALTED);
      expect(mapStakworkStatus('HALTED')).toBe(WorkflowStatus.HALTED);
      expect(mapStakworkStatus('paused')).toBe(WorkflowStatus.HALTED);
      expect(mapStakworkStatus('stopped')).toBe(WorkflowStatus.HALTED);
    });

    it('should return null for unknown status', () => {
      expect(mapStakworkStatus('unknown_status')).toBeNull();
      expect(mapStakworkStatus('invalid')).toBeNull();
      expect(mapStakworkStatus('')).toBeNull();
      expect(mapStakworkStatus('random_text')).toBeNull();
    });

    it('should handle case insensitive mapping', () => {
      expect(mapStakworkStatus('RUNNING')).toBe(WorkflowStatus.IN_PROGRESS);
      expect(mapStakworkStatus('Success')).toBe(WorkflowStatus.COMPLETED);
      expect(mapStakworkStatus('Failed')).toBe(WorkflowStatus.FAILED);
      expect(mapStakworkStatus('Halted')).toBe(WorkflowStatus.HALTED);
    });

    it('should handle partial matches in status strings', () => {
      expect(mapStakworkStatus('task_in_progress_now')).toBe(WorkflowStatus.IN_PROGRESS);
      expect(mapStakworkStatus('workflow_completed_successfully')).toBe(WorkflowStatus.COMPLETED);
      expect(mapStakworkStatus('process_failed_with_error')).toBe(WorkflowStatus.FAILED);
    });
  });
});