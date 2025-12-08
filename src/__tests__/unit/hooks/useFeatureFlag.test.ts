import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { FEATURE_FLAGS } from '@/lib/feature-flags';
import * as workspaceHook from '@/hooks/useWorkspace';
import * as featureFlagLib from '@/lib/feature-flags';
import type { WorkspaceRole } from '@/types';

// Mock the dependencies
vi.mock('@/hooks/useWorkspace');
vi.mock('@/lib/feature-flags');

describe('useFeatureFlag', () => {
  const mockUseWorkspace = vi.mocked(workspaceHook.useWorkspace);
  const mockCanAccessFeature = vi.mocked(featureFlagLib.canAccessFeature);

  // Helper to create workspace context mock
  const createWorkspaceContext = (role?: WorkspaceRole, isLoading = false) => ({
    workspace: role ? {
      id: 'workspace-1',
      name: 'Test Workspace',
      slug: 'test-workspace',
    } : undefined,
    role,
    isLoading,
  } as any);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when user has access to feature', () => {
    it('should return true when feature is enabled for user role', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(true);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'ADMIN'
      );
    });

    it('should return true for OWNER role when feature is accessible', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('OWNER'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(true);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'OWNER'
      );
    });

    it('should return true for PM role when feature is accessible', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('PM'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(true);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'PM'
      );
    });
  });

  describe('when user does not have access to feature', () => {
    it('should return false when feature is disabled in environment', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
    });

    it('should return false when user role is insufficient', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('VIEWER'));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'VIEWER'
      );
    });

    it('should return false when user is STAKEHOLDER without access', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('STAKEHOLDER'));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'STAKEHOLDER'
      );
    });

    it('should return false when user is DEVELOPER without access', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('DEVELOPER'));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'DEVELOPER'
      );
    });
  });

  describe('when workspace context is missing', () => {
    it('should return false when workspace is undefined', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext(undefined, false));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        undefined
      );
    });

    it('should return false when userRole is undefined', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext(undefined, false));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
    });

    it('should return false when workspace is still loading', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext(undefined, true));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(false);
    });
  });

  describe('feature flag edge cases', () => {
    it('should handle invalid feature flag name gracefully', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      mockCanAccessFeature.mockReturnValue(false);

      // Act
      const { result } = renderHook(() => 
        useFeatureFlag('NONEXISTENT_FEATURE' as any)
      );

      // Assert
      expect(result.current).toBe(false);
    });

    it('should call canAccessFeature with correct parameters', () => {
      // Arrange
      const testRole = 'PM' as WorkspaceRole;
      mockUseWorkspace.mockReturnValue(createWorkspaceContext(testRole));
      mockCanAccessFeature.mockReturnValue(true);

      // Act
      renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(mockCanAccessFeature).toHaveBeenCalledTimes(1);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        testRole
      );
    });
  });

  describe('role hierarchy verification', () => {
    const testCases: Array<{
      role: WorkspaceRole;
      hasAccess: boolean;
      description: string;
    }> = [
      { role: 'OWNER', hasAccess: true, description: 'OWNER should have access' },
      { role: 'ADMIN', hasAccess: true, description: 'ADMIN should have access' },
      { role: 'PM', hasAccess: true, description: 'PM should have access' },
      { role: 'DEVELOPER', hasAccess: false, description: 'DEVELOPER should not have access' },
      { role: 'STAKEHOLDER', hasAccess: false, description: 'STAKEHOLDER should not have access' },
      { role: 'VIEWER', hasAccess: false, description: 'VIEWER should not have access' },
    ];

    testCases.forEach(({ role, hasAccess, description }) => {
      it(description, () => {
        // Arrange
        mockUseWorkspace.mockReturnValue(createWorkspaceContext(role));
        mockCanAccessFeature.mockReturnValue(hasAccess);

        // Act
        const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

        // Assert
        expect(result.current).toBe(hasAccess);
        expect(mockCanAccessFeature).toHaveBeenCalledWith(
          FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
          role
        );
      });
    });
  });

  describe('hook behavior across re-renders', () => {
    it('should update result when workspace role changes', () => {
      // Arrange - Initial: VIEWER without access
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('VIEWER'));
      mockCanAccessFeature.mockReturnValue(false);

      // Act - Initial render
      const { result, rerender } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert - Initial state
      expect(result.current).toBe(false);

      // Arrange - Update to ADMIN role with access
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act - Re-render
      rerender();

      // Assert - Updated state
      expect(result.current).toBe(true);
    });

    it('should update result when workspace changes from loading to loaded', () => {
      // Arrange - Initial: loading state
      mockUseWorkspace.mockReturnValue(createWorkspaceContext(undefined, true));
      mockCanAccessFeature.mockReturnValue(false);

      // Act - Initial render (loading)
      const { result, rerender } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert - Initial state
      expect(result.current).toBe(false);

      // Arrange - Workspace loaded with ADMIN role
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act - Re-render
      rerender();

      // Assert - Updated state
      expect(result.current).toBe(true);
    });
  });

  describe('multiple feature flags', () => {
    it('should work with CODEBASE_RECOMMENDATION feature flag', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));

      // Assert
      expect(result.current).toBe(true);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.CODEBASE_RECOMMENDATION,
        'ADMIN'
      );
    });

    it('should work with WORKSPACE_LOGO feature flag', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('OWNER'));
      mockCanAccessFeature.mockReturnValue(true);

      // Act
      const { result } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO));

      // Assert
      expect(result.current).toBe(true);
      expect(mockCanAccessFeature).toHaveBeenCalledWith(
        FEATURE_FLAGS.WORKSPACE_LOGO,
        'OWNER'
      );
    });

    it('should handle different results for different feature flags', () => {
      // Arrange
      mockUseWorkspace.mockReturnValue(createWorkspaceContext('ADMIN'));
      
      // Mock different results for different features
      mockCanAccessFeature.mockImplementation((feature) => {
        return feature === FEATURE_FLAGS.CODEBASE_RECOMMENDATION;
      });

      // Act
      const { result: result1 } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.CODEBASE_RECOMMENDATION));
      const { result: result2 } = renderHook(() => useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO));

      // Assert
      expect(result1.current).toBe(true);
      expect(result2.current).toBe(false);
    });
  });
});
