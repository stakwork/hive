import { describe, it, expect } from 'vitest';
import { checkGooseRunning } from '@/lib/pods/utils';
import { PROCESS_NAMES } from '@/lib/pods/constants';
import { ProcessInfo } from './test-helpers';

describe('checkGooseRunning', () => {
  describe('Standard scenarios', () => {
    it('returns false for empty process list', () => {
      const processList: ProcessInfo[] = [];
      expect(checkGooseRunning(processList)).toBe(false);
    });

    it('returns false when Goose process is not in the list', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'frontend',
          status: 'online',
          pm_uptime: 123456,
          port: '3000',
          cwd: '/workspace/app',
        },
        {
          pid: 5678,
          name: 'backend',
          status: 'online',
          pm_uptime: 123456,
          port: '8000',
          cwd: '/workspace/api',
        },
      ];
      expect(checkGooseRunning(processList)).toBe(false);
    });

    it('returns true when Goose process is in the list', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
          cwd: '/workspace/goose',
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('returns true when Goose is among multiple processes', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'frontend',
          status: 'online',
          pm_uptime: 123456,
          port: '3000',
          cwd: '/workspace/app',
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
          cwd: '/workspace/goose',
        },
        {
          pid: 9012,
          name: 'backend',
          status: 'online',
          pm_uptime: 123456,
          port: '8000',
          cwd: '/workspace/api',
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('returns true when multiple Goose processes exist (finds first match)', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
          cwd: '/workspace/goose',
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'stopping',
          pm_uptime: 123456,
          port: '15552',
          cwd: '/workspace/goose2',
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('returns false for process names with different casing', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'Goose',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'GOOSE',
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(false);
    });

    it('returns false for similar but non-matching names', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'goose-web',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'goose_service',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 9012,
          name: 'my-goose',
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(false);
    });

    it('returns true regardless of process status', () => {
      const statuses = ['online', 'stopping', 'stopped', 'errored', 'launching'];
      
      statuses.forEach((status) => {
        const processList: ProcessInfo[] = [
          {
            pid: 1234,
            name: PROCESS_NAMES.GOOSE,
            status,
            pm_uptime: 123456,
          },
        ];
        expect(checkGooseRunning(processList)).toBe(true);
      });
    });

    it('returns true when Goose process has minimal required fields', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          // port and cwd are optional
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('returns true when Goose process has all optional fields', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
          cwd: '/workspace/goose',
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('handles process with empty string name', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: '',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('handles process list with whitespace in names', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: ' goose',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'goose ',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 9012,
          name: ' goose ',
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(false);
    });
  });

  describe('Boundary conditions', () => {
    it('returns false for process list with only non-Goose processes', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1,
          name: 'process1',
          status: 'online',
          pm_uptime: 1,
        },
        {
          pid: 2,
          name: 'process2',
          status: 'online',
          pm_uptime: 2,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(false);
    });

    it('returns true when Goose is the only process', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('returns true when Goose is first in the list', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'frontend',
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('returns true when Goose is last in the list', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'frontend',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('returns true when Goose is in the middle of the list', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'frontend',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 9012,
          name: 'backend',
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
    });

    it('handles large process list without Goose', () => {
      const processList: ProcessInfo[] = Array.from({ length: 100 }, (_, i) => ({
        pid: i,
        name: `process-${i}`,
        status: 'online',
        pm_uptime: i * 1000,
      }));
      expect(checkGooseRunning(processList)).toBe(false);
    });

    it('handles large process list with Goose', () => {
      const processList: ProcessInfo[] = Array.from({ length: 100 }, (_, i) => ({
        pid: i,
        name: i === 50 ? PROCESS_NAMES.GOOSE : `process-${i}`,
        status: 'online',
        pm_uptime: i * 1000,
      }));
      expect(checkGooseRunning(processList)).toBe(true);
    });
  });

  describe('Process name validation', () => {
    it('returns true only for exact match with PROCESS_NAMES.GOOSE constant', () => {
      const exactMatchList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'goose', // Must match the constant value exactly
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(exactMatchList)).toBe(true);
    });

    it('validates that PROCESS_NAMES.GOOSE is used for matching', () => {
      // This test ensures we're using the constant, not a hardcoded string
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(true);
      expect(PROCESS_NAMES.GOOSE).toBe('goose'); // Verify constant value
    });

    it('returns false for processes with partial name matches', () => {
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'go',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'goo',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 9012,
          name: 'oos',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 3456,
          name: 'oose',
          status: 'online',
          pm_uptime: 123456,
        },
      ];
      expect(checkGooseRunning(processList)).toBe(false);
    });
  });
});