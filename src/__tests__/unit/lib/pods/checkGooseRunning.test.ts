import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkGooseRunning } from '@/lib/pods/utils';
import { PROCESS_NAMES } from '@/lib/pods/constants';
import {
  createGooseProcess,
  createFrontendProcess,
  createApiProcess,
  createProcessInfo,
  createProcessListWithoutGoose,
  type ProcessInfo,
} from '@/__tests__/support/fixtures/pod';

describe('checkGooseRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when Goose process is present', () => {
    it('should return true when single Goose process exists', () => {
      // Arrange
      const processList = [createGooseProcess()];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when Goose process exists among multiple processes', () => {
      // Arrange
      const processList = [
        createFrontendProcess(),
        createGooseProcess(),
        createApiProcess(),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when Goose process is first in list', () => {
      // Arrange
      const processList = [
        createGooseProcess({ port: '15551' }),
        createFrontendProcess({ port: '3000' }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when Goose process is last in list', () => {
      // Arrange
      const processList = [
        createFrontendProcess({ port: '3000' }),
        createApiProcess({ port: '8080' }),
        createGooseProcess({ port: '15551' }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when Goose process has only required fields', () => {
      // Arrange
      const processList = [
        createGooseProcess({ port: undefined, cwd: undefined }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when multiple Goose processes exist (finds first match)', () => {
      // Arrange
      const processList = [
        createGooseProcess({ port: '15551' }),
        createGooseProcess({ pid: 5679, port: '15552' }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should match process name using PROCESS_NAMES.GOOSE constant', () => {
      // Arrange
      const processList = [
        createGooseProcess({ name: PROCESS_NAMES.GOOSE, port: undefined, cwd: undefined }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
      expect(PROCESS_NAMES.GOOSE).toBe('goose');
    });
  });

  describe('when Goose process is absent', () => {
    it('should return false when process list is empty', () => {
      // Arrange
      const processList: ProcessInfo[] = [];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when only non-Goose processes exist', () => {
      // Arrange
      const processList = createProcessListWithoutGoose([
        createFrontendProcess(),
        createApiProcess(),
      ]);

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when process names are similar but not exact match', () => {
      // Arrange
      const processList = [
        createProcessInfo({ name: 'goose-web', pid: 1234 }),
        createProcessInfo({ name: 'goose_service', pid: 5678 }),
        createProcessInfo({ name: 'gooses', pid: 9012 }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when process name has different casing', () => {
      // Arrange
      const processList = [
        createProcessInfo({ name: 'Goose', pid: 5678 }),
        createProcessInfo({ name: 'GOOSE', pid: 5679 }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle large process lists efficiently', () => {
      // Arrange
      const largeProcessList = [
        ...Array.from({ length: 50 }, (_, i) =>
          createProcessInfo({ name: `process-${i}`, pid: i })
        ),
        createGooseProcess(),
      ];

      // Act
      const result = checkGooseRunning(largeProcessList);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle process with stopped status correctly', () => {
      // Arrange
      const processList = [
        createGooseProcess({ status: 'stopped', pm_uptime: 0 }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle process with error status correctly', () => {
      // Arrange
      const processList = [createGooseProcess({ status: 'errored' })];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should handle process with zero uptime', () => {
      // Arrange
      const processList = [
        createGooseProcess({ status: 'launching', pm_uptime: 0 }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should find Goose when mixed with processes with empty optional fields', () => {
      // Arrange
      const processList = [
        createProcessInfo({ name: 'worker-1', pid: 1234 }),
        createGooseProcess({ port: undefined, cwd: undefined }),
        createProcessInfo({ name: 'worker-2', pid: 9012 }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('return value validation', () => {
    it('should return a boolean value', () => {
      // Arrange
      const processList = [createGooseProcess({ port: undefined, cwd: undefined })];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(typeof result).toBe('boolean');
    });

    it('should coerce truthy value to true correctly', () => {
      // Arrange
      const processListWithGoose = [createGooseProcess({ port: undefined, cwd: undefined })];

      // Act
      const result = checkGooseRunning(processListWithGoose);

      // Assert
      expect(result).toBe(true);
      expect(result).not.toBeUndefined();
      expect(result).not.toBeNull();
    });

    it('should coerce falsy value to false correctly', () => {
      // Arrange
      const processListWithoutGoose = [createFrontendProcess()];

      // Act
      const result = checkGooseRunning(processListWithoutGoose);

      // Assert
      expect(result).toBe(false);
      expect(result).not.toBeUndefined();
      expect(result).not.toBeNull();
    });
  });

  describe('integration with PROCESS_NAMES constant', () => {
    it('should use PROCESS_NAMES.GOOSE for process name matching', () => {
      // Arrange
      const processList = [
        createGooseProcess({ name: PROCESS_NAMES.GOOSE, port: undefined, cwd: undefined }),
      ];

      // Act
      const result = checkGooseRunning(processList);

      // Assert
      expect(result).toBe(true);
    });

    it('should correctly identify the expected goose process name value', () => {
      // Assert - verify constant value is as expected
      expect(PROCESS_NAMES.GOOSE).toBe('goose');
    });
  });
});