import { describe, it, expect, vi } from 'vitest';
import { checkGooseRunning } from '@/lib/pods/utils';
import { type ProcessInfo } from './test-helpers';

// Mock PROCESS_NAMES constant - must be inline for vitest hoisting
vi.mock('@/lib/pods/constants', () => ({
  PROCESS_NAMES: {
    FRONTEND: 'frontend',
    GOOSE: 'goose',
  },
  POD_PORTS: {
    CONTROL: '15552',
    GOOSE: '15551',
    FRONTEND_FALLBACK: '3000',
  },
  GOOSE_CONFIG: {
    MAX_STARTUP_ATTEMPTS: 10,
    POLLING_INTERVAL_MS: 1000,
  },
}));

describe('checkGooseRunning', () => {
  describe('when goose process is present', () => {
    it('should return true when process list contains goose process', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: 'goose',
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

    it('should return true when goose is among multiple processes', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1000,
          name: 'frontend',
          status: 'online',
          pm_uptime: 200000,
          port: '3000',
        },
        {
          pid: 2000,
          name: 'api',
          status: 'online',
          pm_uptime: 150000,
          port: '8080',
        },
        {
          pid: 3000,
          name: 'goose',
          status: 'online',
          pm_uptime: 100000,
          port: '15551',
        },
        {
          pid: 4000,
          name: 'worker',
          status: 'online',
          pm_uptime: 50000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true even if goose process has minimal fields', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 5678,
          name: 'goose',
          status: 'online',
          pm_uptime: 5000,
          // port and cwd are optional
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when duplicate goose processes exist', () => {
      // Arrange - Edge case: multiple goose processes (shouldn't happen but function should handle it)
      const processList: ProcessInfo[] = [
        {
          pid: 1111,
          name: 'goose',
          status: 'online',
          pm_uptime: 10000,
          port: '15551',
        },
        {
          pid: 2222,
          name: 'goose',
          status: 'online',
          pm_uptime: 5000,
          port: '15552',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when goose process has different status', () => {
      // Arrange - Function only checks name, not status
      const processList: ProcessInfo[] = [
        {
          pid: 9999,
          name: 'goose',
          status: 'stopped',
          pm_uptime: 0,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('when goose process is absent', () => {
    it('should return false when process list is empty', () => {
      // Arrange
      const processList: ProcessInfo[] = [];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when no goose process exists', () => {
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
          name: 'api',
          status: 'online',
          pm_uptime: 123456,
          port: '8080',
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when processes have similar but not exact names', () => {
      // Arrange - Test case sensitivity and partial matches
      const processList: ProcessInfo[] = [
        {
          pid: 1000,
          name: 'goose-web',
          status: 'online',
          pm_uptime: 10000,
        },
        {
          pid: 2000,
          name: 'my-goose',
          status: 'online',
          pm_uptime: 10000,
        },
        {
          pid: 3000,
          name: 'goose_service',
          status: 'online',
          pm_uptime: 10000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when process name has different casing', () => {
      // Arrange - Test case sensitivity (should be exact match)
      const processList: ProcessInfo[] = [
        {
          pid: 7777,
          name: 'GOOSE',
          status: 'online',
          pm_uptime: 10000,
        },
        {
          pid: 8888,
          name: 'Goose',
          status: 'online',
          pm_uptime: 10000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when process name contains goose as substring', () => {
      // Arrange - Partial match should not count
      const processList: ProcessInfo[] = [
        {
          pid: 1111,
          name: 'gooseberry',
          status: 'online',
          pm_uptime: 5000,
        },
        {
          pid: 2222,
          name: 'mongoose',
          status: 'online',
          pm_uptime: 5000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle process list with one non-goose process', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 999,
          name: 'frontend',
          status: 'online',
          pm_uptime: 1000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle process list with many processes but no goose', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        { pid: 1, name: 'frontend', status: 'online', pm_uptime: 1000 },
        { pid: 2, name: 'api', status: 'online', pm_uptime: 1000 },
        { pid: 3, name: 'worker-1', status: 'online', pm_uptime: 1000 },
        { pid: 4, name: 'worker-2', status: 'online', pm_uptime: 1000 },
        { pid: 5, name: 'cron', status: 'online', pm_uptime: 1000 },
        { pid: 6, name: 'queue', status: 'online', pm_uptime: 1000 },
        { pid: 7, name: 'scheduler', status: 'online', pm_uptime: 1000 },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle process with empty string name', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1234,
          name: '',
          status: 'online',
          pm_uptime: 1000,
        },
        {
          pid: 5678,
          name: 'goose',
          status: 'online',
          pm_uptime: 2000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle process list with whitespace in names', () => {
      // Arrange - Whitespace should not match
      const processList: ProcessInfo[] = [
        {
          pid: 1111,
          name: ' goose',
          status: 'online',
          pm_uptime: 1000,
        },
        {
          pid: 2222,
          name: 'goose ',
          status: 'online',
          pm_uptime: 1000,
        },
        {
          pid: 3333,
          name: ' goose ',
          status: 'online',
          pm_uptime: 1000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('return value type validation', () => {
    it('should return boolean true when goose is present', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1,
          name: 'goose',
          status: 'online',
          pm_uptime: 1000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });

    it('should return boolean false when goose is absent', () => {
      // Arrange
      const processList: ProcessInfo[] = [
        {
          pid: 1,
          name: 'frontend',
          status: 'online',
          pm_uptime: 1000,
        },
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    });

    it('should return boolean false for empty array', () => {
      // Arrange
      const processList: ProcessInfo[] = [];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(typeof result).toBe('boolean');
      expect(result).toBe(false);
    });
  });
});