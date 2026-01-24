/**
 * Unit tests for PR metrics calculation logic
 */
import { describe, test, expect } from 'vitest';
import { PullRequestContent } from '@/lib/chat';

interface ArtifactData {
  id: string;
  content: PullRequestContent;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Calculate PR metrics from artifact data
 * Extracted from route handler for unit testing
 */
export function calculatePRMetrics(artifacts: ArtifactData[]) {
  const prCount = artifacts.length;
  let mergedCount = 0;
  let totalMergeTimeHours = 0;

  for (const artifact of artifacts) {
    const content = artifact.content;
    
    if (content?.status === "DONE") {
      mergedCount++;
      // Calculate time to merge in hours
      const timeToMergeMs = artifact.updatedAt.getTime() - artifact.createdAt.getTime();
      const timeToMergeHours = timeToMergeMs / (1000 * 60 * 60);
      totalMergeTimeHours += timeToMergeHours;
    }
  }

  // Calculate success rate (null if < 3 PRs)
  const successRate = prCount >= 3 
    ? Math.round((mergedCount / prCount) * 100 * 100) / 100 // Round to 2 decimals
    : null;

  // Calculate average time to merge (null if no merged PRs)
  const avgTimeToMerge = mergedCount > 0
    ? Math.round((totalMergeTimeHours / mergedCount) * 100) / 100 // Round to 2 decimals
    : null;

  return {
    successRate,
    avgTimeToMerge,
    prCount,
    mergedCount,
  };
}

describe('PR Metrics Calculator', () => {
  describe('successRate calculation', () => {
    test('should return null when prCount < 3', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'OPEN' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T11:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.successRate).toBeNull();
      expect(result.prCount).toBe(2);
      expect(result.mergedCount).toBe(1);
    });

    test('should calculate successRate when prCount >= 3', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'DONE' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T13:00:00Z'),
        },
        {
          id: '3',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/3', status: 'OPEN' },
          createdAt: new Date('2024-01-01T12:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.successRate).toBe(66.67); // 2/3 * 100
      expect(result.prCount).toBe(3);
      expect(result.mergedCount).toBe(2);
    });

    test('should calculate 100% successRate when all PRs are merged', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'DONE' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T13:00:00Z'),
        },
        {
          id: '3',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/3', status: 'DONE' },
          createdAt: new Date('2024-01-01T12:00:00Z'),
          updatedAt: new Date('2024-01-01T14:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.successRate).toBe(100);
      expect(result.prCount).toBe(3);
      expect(result.mergedCount).toBe(3);
    });

    test('should calculate 0% successRate when no PRs are merged', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'OPEN' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'CLOSED' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T11:00:00Z'),
        },
        {
          id: '3',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/3', status: 'CANCELLED' },
          createdAt: new Date('2024-01-01T12:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.successRate).toBe(0);
      expect(result.prCount).toBe(3);
      expect(result.mergedCount).toBe(0);
    });
  });

  describe('avgTimeToMerge calculation', () => {
    test('should return null when no PRs are merged', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'OPEN' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'CLOSED' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T11:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.avgTimeToMerge).toBeNull();
      expect(result.mergedCount).toBe(0);
    });

    test('should calculate avgTimeToMerge correctly for single merged PR', () => {
      // PR merged 2 hours after creation
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.avgTimeToMerge).toBe(2);
      expect(result.mergedCount).toBe(1);
    });

    test('should calculate avgTimeToMerge correctly for multiple merged PRs', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'), // 2 hours
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'DONE' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T15:00:00Z'), // 4 hours
        },
        {
          id: '3',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/3', status: 'OPEN' },
          createdAt: new Date('2024-01-01T12:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'), // Should be ignored
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.avgTimeToMerge).toBe(3); // (2 + 4) / 2 = 3
      expect(result.mergedCount).toBe(2);
    });

    test('should calculate avgTimeToMerge in fractional hours', () => {
      // PR merged 1.5 hours after creation
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T11:30:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.avgTimeToMerge).toBe(1.5);
      expect(result.mergedCount).toBe(1);
    });

    test('should round avgTimeToMerge to 2 decimal places', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:20:00Z'), // 0.333... hours
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'DONE' },
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T11:40:00Z'), // 0.666... hours
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.avgTimeToMerge).toBe(0.5); // (0.333 + 0.666) / 2 = 0.5
      expect(result.mergedCount).toBe(2);
    });
  });

  describe('edge cases', () => {
    test('should handle empty artifact list', () => {
      const artifacts: ArtifactData[] = [];

      const result = calculatePRMetrics(artifacts);
      expect(result.successRate).toBeNull();
      expect(result.avgTimeToMerge).toBeNull();
      expect(result.prCount).toBe(0);
      expect(result.mergedCount).toBe(0);
    });

    test('should only count status="DONE" as merged', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T12:00:00Z'),
        },
        {
          id: '2',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/2', status: 'done' }, // lowercase - should not count
          createdAt: new Date('2024-01-01T11:00:00Z'),
          updatedAt: new Date('2024-01-01T13:00:00Z'),
        },
        {
          id: '3',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/3', status: 'MERGED' }, // different status - should not count
          createdAt: new Date('2024-01-01T12:00:00Z'),
          updatedAt: new Date('2024-01-01T14:00:00Z'),
        },
        {
          id: '4',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/4', status: 'CLOSED' },
          createdAt: new Date('2024-01-01T13:00:00Z'),
          updatedAt: new Date('2024-01-01T15:00:00Z'),
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.mergedCount).toBe(1); // Only the first one with status="DONE"
      expect(result.prCount).toBe(4);
    });

    test('should handle PR with same createdAt and updatedAt (0 hours merge time)', () => {
      const artifacts: ArtifactData[] = [
        {
          id: '1',
          content: { repo: 'test/repo', url: 'https://github.com/test/repo/pull/1', status: 'DONE' },
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'), // Merged instantly
        },
      ];

      const result = calculatePRMetrics(artifacts);
      expect(result.avgTimeToMerge).toBe(0);
      expect(result.mergedCount).toBe(1);
    });

    test('should handle large numbers of PRs', () => {
      const artifacts: ArtifactData[] = Array.from({ length: 100 }, (_, i) => ({
        id: `${i + 1}`,
        content: { 
          repo: 'test/repo', 
          url: `https://github.com/test/repo/pull/${i + 1}`, 
          status: i % 2 === 0 ? 'DONE' : 'OPEN' 
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T11:00:00Z'), // 1 hour merge time
      }));

      const result = calculatePRMetrics(artifacts);
      expect(result.prCount).toBe(100);
      expect(result.mergedCount).toBe(50);
      expect(result.successRate).toBe(50);
      expect(result.avgTimeToMerge).toBe(1);
    });
  });
});
