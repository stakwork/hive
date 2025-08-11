import { canAccessFeature } from '@/lib/feature-flags';
import { useWorkspace } from '@/hooks/useWorkspace';

export function useFeatureFlag(feature: string): boolean {
  const { role } = useWorkspace();
  return canAccessFeature(feature, role);
}