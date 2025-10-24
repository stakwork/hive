import { describe, it, expect } from 'vitest';
import { checkGooseRunning } from '@/lib/pods/utils';
import { PROCESS_NAMES } from '@/lib/pods/constants';
import { createMockProcess, type ProcessInfo } from '@/__tests__/support/fixtures';

describe('checkGooseRunning', () => {
  describe('basic functionality', () => {
    it('should return true when goose process is present in the list', () => {
      // Arrange
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

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when goose process is not present in the list', () => {
      // Arrange
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
          name: 'api',
          status: 'online',
          pm_uptime: 123456,
          port: '8080',
          cwd: '/workspace/api',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when process list is empty', () => {
      // Arrange
      const processList: ProcessInfo[] = [];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when goose is one of multiple processes', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'frontend',
          status: 'online',
          pm_uptime: 123456,
          port: '3000',
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
        },
        {
          pid: 9012,
          name: 'api',
          status: 'online',
          pm_uptime: 123456,
          port: '8080',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should return true for first occurrence when duplicate goose processes exist', () => {
      // Arrange - Multiple goose processes (edge case, shouldn't happen but test defensively)
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
        },
        {
          pid: 5678,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 789012,
          port: '15552',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should work with processes missing optional fields (port, cwd)', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          // port and cwd omitted
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for processes with similar but non-matching names', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'goose-proxy',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'goose_web',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 9012,
          name: 'Goose', // Different case
          status: 'online',
          pm_uptime: 123456,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should work regardless of process status', () => {
      // Arrange - Goose process with non-standard status
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'stopping',
          pm_uptime: 123456,
          port: '15551',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should work with various uptime values', () => {
      // Arrange - Goose process with low uptime (just started)
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 100, // Very low uptime
          port: '15551',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('large process lists', () => {
    it('should efficiently find goose in a large process list', () => {
      // Arrange - Many processes with goose at the end
      const processList: ProcessInfo[] = [
        ...Array.from({ length: 50 }, (_, i) => ({
          pid: i + 1000,
          name: `worker-${i}`,
          status: 'online',
          pm_uptime: 123456,
        })),
        {
          pid: 9999,
          name: PROCESS_NAMES.GOOSE,
          status: 'online',
          pm_uptime: 123456,
          port: '15551',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should efficiently return false for large process lists without goose', () => {
      // Arrange - Many processes without goose
      const processList: ProcessInfo[] = Array.from({ length: 100 }, (_, i) => ({
        pid: i + 1000,
        name: `service-${i}`,
        status: 'online',
        pm_uptime: 123456,
      }));

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('process name matching', () => {
    it('should match exact process name only', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'goose',
          status: 'online',
          pm_uptime: 123456,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
      // Verify we're checking against the expected constant value
      expect(PROCESS_NAMES.GOOSE).toBe('goose');
    });

    it('should be case-sensitive in process name matching', () => {
      // Arrange - Process names with different casing
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'GOOSE',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 5678,
          name: 'Goose',
          status: 'online',
          pm_uptime: 123456,
        },
        {
          pid: 9012,
          name: 'GoOsE',
          status: 'online',
          pm_uptime: 123456,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });
  });
});