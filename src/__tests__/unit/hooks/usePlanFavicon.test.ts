// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowStatus } from '@prisma/client';
import { usePlanFavicon } from '@/hooks/usePlanFavicon';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useFavicon', () => ({
  useFavicon: vi.fn(() => ({ isUpdating: false })),
}));

vi.mock('@/lib/runtime', () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePlanFavicon', () => {
  let useFaviconMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    const { useFavicon } = await import('@/hooks/useFavicon');
    useFaviconMock = useFavicon as ReturnType<typeof vi.fn>;
    useFaviconMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('defaults to overlayType "none" when workflowStatus is null', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: null }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'none', workspaceLogoUrl: null, enabled: true })
    );
  });

  it('sets overlayType "busy" when workflowStatus is IN_PROGRESS', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.IN_PROGRESS }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'busy' })
    );
  });

  it('sets overlayType "waiting" when workflowStatus is HALTED', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.HALTED }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'waiting' })
    );
  });

  it('sets overlayType "done" when workflowStatus is COMPLETED', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.COMPLETED }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'done' })
    );
  });

  it('auto-clears overlay to "none" after 5 seconds when COMPLETED', async () => {
    const { rerender } = renderHook(
      ({ status }) => usePlanFavicon({ workflowStatus: status }),
      { initialProps: { status: WorkflowStatus.COMPLETED as WorkflowStatus | null } }
    );

    // Immediately after COMPLETED, should be 'done'
    expect(useFaviconMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlayType: 'done' })
    );

    // Advance timer by 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    rerender({ status: WorkflowStatus.COMPLETED });

    // After timeout, should revert to 'none'
    expect(useFaviconMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlayType: 'none' })
    );
  });

  it('sets overlayType "none" for PENDING status', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.PENDING }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'none' })
    );
  });

  it('sets overlayType "none" for ERROR status', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.ERROR }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'none' })
    );
  });

  it('sets overlayType "none" for FAILED status', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.FAILED }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ overlayType: 'none' })
    );
  });

  it('clears pending timeout when status changes before 5s', () => {
    const { rerender } = renderHook(
      ({ status }) => usePlanFavicon({ workflowStatus: status }),
      { initialProps: { status: WorkflowStatus.COMPLETED as WorkflowStatus | null } }
    );

    // Should be 'done' initially
    expect(useFaviconMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlayType: 'done' })
    );

    // Status changes to IN_PROGRESS before 5s
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender({ status: WorkflowStatus.IN_PROGRESS });

    expect(useFaviconMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlayType: 'busy' })
    );

    // Advance remaining time — should NOT revert to 'none' since timer was cleared
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(useFaviconMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ overlayType: 'busy' })
    );
  });

  it('passes workspaceLogoUrl as null always', () => {
    renderHook(() => usePlanFavicon({ workflowStatus: WorkflowStatus.IN_PROGRESS }));

    expect(useFaviconMock).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceLogoUrl: null })
    );
  });
});
