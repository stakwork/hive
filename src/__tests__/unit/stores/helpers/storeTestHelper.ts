import { renderHook, act } from "@testing-library/react";
import { useInsightsStore } from "@/stores/useInsightsStore";

/**
 * Test wrapper for acceptRecommendation action
 */
export const testAcceptRecommendation = async (recommendationId: string) => {
  const { result } = renderHook(() => useInsightsStore());
  
  let returnValue: any;
  await act(async () => {
    returnValue = await result.current.acceptRecommendation(recommendationId);
  });
  
  return { result, returnValue };
};

/**
 * Test wrapper for dismissRecommendation action  
 */
export const testDismissRecommendation = async (recommendationId: string) => {
  const { result } = renderHook(() => useInsightsStore());
  
  await act(async () => {
    await result.current.dismissRecommendation(recommendationId);
  });
  
  return { result };
};

/**
 * Setup a fresh store for testing
 */
export const setupFreshStore = () => {
  const { result } = renderHook(() => useInsightsStore());
  act(() => {
    result.current.reset();
  });
  return result;
};

/**
 * Get store instance for testing
 */
export const getStoreInstance = () => {
  const { result } = renderHook(() => useInsightsStore());
  return result;
};
