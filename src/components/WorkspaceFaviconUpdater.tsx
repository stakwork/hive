'use client';

import { useWorkspace } from '@/hooks/useWorkspace';
import { useWorkspaceFavicon } from '@/hooks/useWorkspaceFavicon';

/**
 * Client component that updates the browser favicon based on the current workspace logo
 * Should be included in workspace layouts to provide dynamic favicon functionality
 */
export function WorkspaceFaviconUpdater() {
  const { workspace } = useWorkspace();
  
  // Update favicon when workspace or logo changes
  useWorkspaceFavicon(workspace?.slug || null, workspace?.logoKey);
  
  // This component doesn't render anything
  return null;
}
