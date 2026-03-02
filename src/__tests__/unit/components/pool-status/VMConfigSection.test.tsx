import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { VMConfigSection } from '@/components/pool-status';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useModal } from '@/components/modals/ModlaProvider';
import { toast } from 'sonner';

// Mock dependencies
vi.mock('@/hooks/useWorkspace');
vi.mock('@/components/modals/ModlaProvider');
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('VMConfigSection', () => {
  const mockSlug = 'test-workspace';
  const mockUseWorkspace = vi.mocked(useWorkspace);
  const mockUseModal = vi.mocked(useModal);
  const mockOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseModal.mockReturnValue(mockOpen);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    });
  });

  describe('Pool State: NOT_STARTED or STARTED (not complete)', () => {
    it('should show "In progress" indicator when services are not ready', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'STARTED',
          containerFilesSetUp: false,
        },
      } as any);

      render(<VMConfigSection />);

      expect(screen.getByText('In progress')).toBeInTheDocument();
      expect(screen.queryByText('Launch Pods')).not.toBeInTheDocument();
    });

    it('should show "Launch Pods" button when services are ready', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      expect(screen.queryByText('In progress')).not.toBeInTheDocument();
      expect(screen.getByText('Launch Pods')).toBeInTheDocument();
    });

    it('should not show both "In progress" and "Launch Pods" simultaneously', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'NOT_STARTED',
          containerFilesSetUp: false,
        },
      } as any);

      const { rerender } = render(<VMConfigSection />);

      // Initially in progress
      expect(screen.getByText('In progress')).toBeInTheDocument();
      expect(screen.queryByText('Launch Pods')).not.toBeInTheDocument();

      // Update to services ready
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
      } as any);

      rerender(<VMConfigSection />);

      // Now only Launch Pods should show
      expect(screen.queryByText('In progress')).not.toBeInTheDocument();
      expect(screen.getByText('Launch Pods')).toBeInTheDocument();
    });

    it('should display correct message when services are being set up', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'NOT_STARTED',
          containerFilesSetUp: false,
        },
      } as any);

      render(<VMConfigSection />);

      expect(screen.getByText('Services are being set up.')).toBeInTheDocument();
    });

    it('should display correct message when services are ready but pool not complete', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      expect(screen.getByText('Complete your pool setup to get started.')).toBeInTheDocument();
    });
  });

  describe('Pool State: COMPLETE', () => {
    it('should fetch and display pool status when pool is active', async () => {
      const mockPoolStatus = {
        success: true,
        data: {
          status: {
            usedVms: 3,
            unusedVms: 2,
            pendingVms: 1,
            failedVms: 0,
            runningVms: 5,
            lastCheck: '2025-01-15T10:00:00Z',
          },
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockPoolStatus,
      });

      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      await waitFor(() => {
        expect(screen.getByText('3 in use')).toBeInTheDocument();
        expect(screen.getByText('2 available')).toBeInTheDocument();
      });

      expect(screen.queryByText('In progress')).not.toBeInTheDocument();
      expect(screen.queryByText('Launch Pods')).not.toBeInTheDocument();
    });

    it('should display pending and failed VMs when present', async () => {
      const mockPoolStatus = {
        success: true,
        data: {
          status: {
            usedVms: 2,
            unusedVms: 1,
            pendingVms: 2,
            failedVms: 1,
            runningVms: 3,
            lastCheck: '2025-01-15T10:00:00Z',
          },
        },
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockPoolStatus,
      });

      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      await waitFor(() => {
        expect(screen.getByText('2 pending')).toBeInTheDocument();
        expect(screen.getByText('1 failed')).toBeInTheDocument();
      });
    });

    it('should show Edit Configuration dropdown when pool is active', async () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      await waitFor(() => {
        const dropdown = screen.getByRole('button', { name: '' });
        expect(dropdown).toBeInTheDocument();
      });
    });

    it('should display error message when pool status fetch fails', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          message: 'Unable to fetch pool data',
        }),
      });

      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      await waitFor(() => {
        expect(screen.getByText('Unable to fetch pool data')).toBeInTheDocument();
      });
    });
  });

  describe('Pool State: FAILED', () => {
    it('should handle failed pool state gracefully', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'FAILED',
          containerFilesSetUp: false,
        },
      } as any);

      render(<VMConfigSection />);

      expect(screen.getByText('In progress')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should not fetch pool status when slug is missing', () => {
      mockUseWorkspace.mockReturnValue({
        slug: null,
        workspace: {
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not fetch pool status when pool is not active', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'STARTED',
          containerFilesSetUp: true,
        },
      } as any);

      render(<VMConfigSection />);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle missing workspace data', () => {
      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: null,
      } as any);

      render(<VMConfigSection />);

      expect(screen.getByText('Services are being set up.')).toBeInTheDocument();
      expect(screen.getByText('In progress')).toBeInTheDocument();
    });
  });

  describe('Superadmin Controls', () => {
    beforeEach(() => {
      // Setup for active pool with status
      const mockPoolStatus = {
        success: true,
        data: {
          status: {
            usedVms: 3,
            unusedVms: 2,
            pendingVms: 0,
            failedVms: 0,
            runningVms: 5,
            lastCheck: '2025-01-15T10:00:00Z',
          },
        },
      };

      (global.fetch as any).mockImplementation((url: string) => {
        if (url.includes('/pool/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockPoolStatus,
          });
        }
        if (url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { minimumVms: 3, isSuperAdmin: true },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: false }),
        });
      });

      mockUseWorkspace.mockReturnValue({
        slug: mockSlug,
        workspace: {
          poolState: 'COMPLETE',
          containerFilesSetUp: true,
        },
      } as any);
    });

    it('should render Amount of Pods input and Save button for superadmin with active pool', async () => {
      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      });

      const input = screen.getByLabelText('Amount of Pods') as HTMLInputElement;
      expect(input.value).toBe('3');
    });

    it('should NOT render Amount of Pods input for non-superadmin with active pool', async () => {
      render(<VMConfigSection isSuperAdmin={false} />);

      await waitFor(() => {
        expect(screen.getByText('3 in use')).toBeInTheDocument();
      });

      expect(screen.queryByLabelText('Amount of Pods')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });

    it('should call PATCH /api/w/[slug]/pool/config with correct body when Save is clicked', async () => {
      const mockPatch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      (global.fetch as any).mockImplementation((url: string, options?: any) => {
        if (options?.method === 'PATCH' && url.includes('/pool/config')) {
          return mockPatch(url, options);
        }
        if (url.includes('/pool/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                status: {
                  usedVms: 3,
                  unusedVms: 2,
                  pendingVms: 0,
                  failedVms: 0,
                  runningVms: 5,
                  lastCheck: '2025-01-15T10:00:00Z',
                },
              },
            }),
          });
        }
        if (url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { minimumVms: 3, isSuperAdmin: true },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: false }),
        });
      });

      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
      });

      const input = screen.getByLabelText('Amount of Pods') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockPatch).toHaveBeenCalledWith(
          `/api/w/${mockSlug}/pool/config`,
          expect.objectContaining({
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ minimumVms: 5 }),
          })
        );
      });
    });

    it('should disable Save button when pendingVms equals minimumVms', async () => {
      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /save/i });
      expect(saveButton).toBeDisabled();
    });

    it('should show success toast when PATCH succeeds', async () => {
      (global.fetch as any).mockImplementation((url: string, options?: any) => {
        if (options?.method === 'PATCH' && url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: true }),
          });
        }
        if (url.includes('/pool/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                status: {
                  usedVms: 3,
                  unusedVms: 2,
                  pendingVms: 0,
                  failedVms: 0,
                  runningVms: 5,
                  lastCheck: '2025-01-15T10:00:00Z',
                },
              },
            }),
          });
        }
        if (url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { minimumVms: 3, isSuperAdmin: true },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: false }),
        });
      });

      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
      });

      const input = screen.getByLabelText('Amount of Pods') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Amount of Pods updated');
      });
    });

    it('should show error toast when PATCH fails', async () => {
      (global.fetch as any).mockImplementation((url: string, options?: any) => {
        if (options?.method === 'PATCH' && url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ success: false }),
          });
        }
        if (url.includes('/pool/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                status: {
                  usedVms: 3,
                  unusedVms: 2,
                  pendingVms: 0,
                  failedVms: 0,
                  runningVms: 5,
                  lastCheck: '2025-01-15T10:00:00Z',
                },
              },
            }),
          });
        }
        if (url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { minimumVms: 3, isSuperAdmin: true },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: false }),
        });
      });

      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
      });

      const input = screen.getByLabelText('Amount of Pods') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to update Amount of Pods');
      });
    });

    it('should enforce minimum value of 1 client-side', async () => {
      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
      });

      const input = screen.getByLabelText('Amount of Pods') as HTMLInputElement;
      
      // Try to set to 0
      fireEvent.change(input, { target: { value: '0' } });
      expect(input.value).toBe('1');

      // Try to set to negative
      fireEvent.change(input, { target: { value: '-5' } });
      expect(input.value).toBe('1');
    });

    it('should disable input and button while saving', async () => {
      let resolvePatch: any;
      const patchPromise = new Promise((resolve) => {
        resolvePatch = resolve;
      });

      (global.fetch as any).mockImplementation((url: string, options?: any) => {
        if (options?.method === 'PATCH' && url.includes('/pool/config')) {
          return patchPromise;
        }
        if (url.includes('/pool/status')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: {
                status: {
                  usedVms: 3,
                  unusedVms: 2,
                  pendingVms: 0,
                  failedVms: 0,
                  runningVms: 5,
                  lastCheck: '2025-01-15T10:00:00Z',
                },
              },
            }),
          });
        }
        if (url.includes('/pool/config')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              success: true,
              data: { minimumVms: 3, isSuperAdmin: true },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: false }),
        });
      });

      render(<VMConfigSection isSuperAdmin={true} />);

      await waitFor(() => {
        expect(screen.getByLabelText('Amount of Pods')).toBeInTheDocument();
      });

      const input = screen.getByLabelText('Amount of Pods') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '5' } });

      const saveButton = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument();
      });

      expect(input).toBeDisabled();
      expect(saveButton).toBeDisabled();

      // Resolve the promise
      resolvePatch({
        ok: true,
        json: async () => ({ success: true }),
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      });
    });
  });
});
