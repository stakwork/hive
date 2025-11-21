import { canAccessFeature, type FeatureFlag } from "@/lib/feature-flags";
import { useWorkspace } from "@/hooks/useWorkspace";

export function useFeatureFlag(feature: FeatureFlag): boolean {
  const { role } = useWorkspace();
  return canAccessFeature(feature, role ?? undefined);
}
