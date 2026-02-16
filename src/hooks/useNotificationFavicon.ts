import { useFavicon } from './useFavicon';
import { useWorkspace } from './useWorkspace';

interface UseNotificationFaviconOptions {
  workspaceLogoUrl?: string | null;
  enabled?: boolean;
}

/**
 * Hook to manage favicon notifications based on tasks awaiting user input.
 * Automatically adds a yellow notification dot to the favicon when tasks
 * have pending FORM artifacts requiring user input.
 */
export function useNotificationFavicon({ 
  workspaceLogoUrl = null, 
  enabled = true 
}: UseNotificationFaviconOptions = {}) {
  const { waitingForInputCount } = useWorkspace();
  
  // Determine if notification dot should be shown
  const showNotificationDot = waitingForInputCount > 0;

  // Use the base favicon hook with notification dot parameter
  const result = useFavicon({
    workspaceLogoUrl,
    enabled,
    showNotificationDot,
  });

  return {
    ...result,
    showNotificationDot,
    waitingForInputCount,
  };
}
