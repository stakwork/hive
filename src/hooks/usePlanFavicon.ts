import { useEffect, useRef, useState } from 'react';
import { WorkflowStatus } from '@/lib/chat';
import { useFavicon } from './useFavicon';

type FaviconOverlay = 'none' | 'busy' | 'waiting' | 'done';

export function usePlanFavicon({ workflowStatus }: { workflowStatus: WorkflowStatus | null }) {
  const [overlayType, setOverlayType] = useState<FaviconOverlay>('none');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending reset timer
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    switch (workflowStatus) {
      case WorkflowStatus.IN_PROGRESS:
        setOverlayType('busy');
        break;
      case WorkflowStatus.HALTED:
        setOverlayType('waiting');
        break;
      case WorkflowStatus.COMPLETED:
        setOverlayType('done');
        // Auto-clear after 5 seconds
        timeoutRef.current = setTimeout(() => setOverlayType('none'), 5000);
        break;
      default:
        setOverlayType('none');
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [workflowStatus]);

  // workspaceLogoUrl intentionally null — keeps canvas same-origin only
  useFavicon({ workspaceLogoUrl: null, overlayType, enabled: true });
}
