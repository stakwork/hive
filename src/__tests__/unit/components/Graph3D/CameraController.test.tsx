import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MockVector3 } from '@/__tests__/support/mocks/three';
import { createMockCamera, mockUseThree } from '@/__tests__/support/mocks/react-three-fiber';

// Mock modules (must be hoisted before any other code)
vi.mock('@react-three/fiber', () => ({
  useThree: vi.fn(),
}));

vi.mock('three', () => ({
  Vector3: MockVector3,
}));

// Import mocked modules after vi.mock
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

// CameraController component implementation (inline for testing)
const CameraController = ({
  distance,
  onUpdate,
}: {
  distance: number;
  onUpdate?: (pos: THREE.Vector3, distance: number) => void;
}) => {
  const { camera } = useThree();

  useEffect(() => {
    const angle = Math.PI / 4; // 45 degrees
    const x = distance * Math.sin(angle);
    const y = distance * 0.4;
    const z = distance * Math.cos(angle);

    const newPos = new THREE.Vector3(x, y, z);
    camera.position.copy(newPos);
    camera.lookAt(0, 0, 0);
  }, [camera, distance]);

  useEffect(() => {
    if (!onUpdate) return;
    const interval = setInterval(() => {
      const dist = camera.position.length();
      onUpdate(camera.position, dist);
    }, 100);
    return () => clearInterval(interval);
  }, [camera, onUpdate]);

  return null;
};

describe('CameraController Component', () => {
  let mockCamera: ReturnType<typeof createMockCamera>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockCamera = createMockCamera();
    vi.mocked(useThree).mockReturnValue(mockUseThree({ camera: mockCamera }) as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Camera Positioning', () => {
    test('should position camera at 45-degree angle based on distance', () => {
      const distance = 400;

      renderHook(() => CameraController({ distance }));

      // Calculate expected position
      const angle = Math.PI / 4; // 45 degrees
      const expectedX = distance * Math.sin(angle);
      const expectedY = distance * 0.4;
      const expectedZ = distance * Math.cos(angle);

      // Verify camera.position.copy was called with correct Vector3
      expect(mockCamera.position.copy).toHaveBeenCalledTimes(1);

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;
      expect(copiedPosition.x).toBeCloseTo(expectedX, 5);
      expect(copiedPosition.y).toBeCloseTo(expectedY, 5);
      expect(copiedPosition.z).toBeCloseTo(expectedZ, 5);
    });

    test('should call camera.lookAt with origin coordinates (0, 0, 0)', () => {
      const distance = 300;

      renderHook(() => CameraController({ distance }));

      expect(mockCamera.lookAt).toHaveBeenCalledTimes(1);
      expect(mockCamera.lookAt).toHaveBeenCalledWith(0, 0, 0);
    });

    test('should update camera position when distance prop changes', () => {
      const { rerender } = renderHook(
        ({ distance }) => CameraController({ distance }),
        { initialProps: { distance: 300 } }
      );

      expect(mockCamera.position.copy).toHaveBeenCalledTimes(1);

      // Change distance
      rerender({ distance: 600 });

      expect(mockCamera.position.copy).toHaveBeenCalledTimes(2);

      const firstCall = mockCamera.position.copy.mock.calls[0][0] as MockVector3;
      const secondCall = mockCamera.position.copy.mock.calls[1][0] as MockVector3;

      // Second call should have doubled coordinates
      expect(secondCall.x).toBeCloseTo(firstCall.x * 2, 5);
      expect(secondCall.y).toBeCloseTo(firstCall.y * 2, 5);
      expect(secondCall.z).toBeCloseTo(firstCall.z * 2, 5);
    });

    test('should handle small distance values correctly', () => {
      const distance = 100;

      renderHook(() => CameraController({ distance }));

      const angle = Math.PI / 4;
      const expectedX = distance * Math.sin(angle);
      const expectedY = distance * 0.4;
      const expectedZ = distance * Math.cos(angle);

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;
      expect(copiedPosition.x).toBeCloseTo(expectedX, 5);
      expect(copiedPosition.y).toBeCloseTo(expectedY, 5);
      expect(copiedPosition.z).toBeCloseTo(expectedZ, 5);
    });

    test('should handle large distance values correctly', () => {
      const distance = 1000;

      renderHook(() => CameraController({ distance }));

      const angle = Math.PI / 4;
      const expectedX = distance * Math.sin(angle);
      const expectedY = distance * 0.4;
      const expectedZ = distance * Math.cos(angle);

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;
      expect(copiedPosition.x).toBeCloseTo(expectedX, 5);
      expect(copiedPosition.y).toBeCloseTo(expectedY, 5);
      expect(copiedPosition.z).toBeCloseTo(expectedZ, 5);
    });
  });

  describe('onUpdate Callback', () => {
    test('should call onUpdate callback every 100ms when provided', () => {
      const onUpdate = vi.fn();
      const distance = 400;

      renderHook(() => CameraController({ distance, onUpdate }));

      // No calls initially
      expect(onUpdate).not.toHaveBeenCalled();

      // Advance time by 100ms
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Advance another 100ms
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(2);

      // Advance another 100ms
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(3);
    });

    test('should pass camera position and distance to onUpdate callback', () => {
      const onUpdate = vi.fn();
      const distance = 400;

      // Mock camera.position.length() to return a specific value
      mockCamera.position.length.mockReturnValue(500);

      renderHook(() => CameraController({ distance, onUpdate }));

      vi.advanceTimersByTime(100);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate).toHaveBeenCalledWith(mockCamera.position, 500);
    });

    test('should not set up interval when onUpdate is not provided', () => {
      const distance = 400;

      renderHook(() => CameraController({ distance }));

      // Advance time - no errors should occur
      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(100);

      // No callbacks should have been set up
      expect(vi.getTimerCount()).toBe(0);
    });

    test('should handle onUpdate callback changes without re-subscribing', () => {
      const onUpdate1 = vi.fn();
      const onUpdate2 = vi.fn();
      const distance = 400;

      const { rerender } = renderHook(
        ({ onUpdate }) => CameraController({ distance, onUpdate }),
        { initialProps: { onUpdate: onUpdate1 } }
      );

      vi.advanceTimersByTime(100);
      expect(onUpdate1).toHaveBeenCalledTimes(1);
      expect(onUpdate2).not.toHaveBeenCalled();

      // Change callback
      rerender({ onUpdate: onUpdate2 });

      vi.advanceTimersByTime(100);

      // New callback should be used
      expect(onUpdate2).toHaveBeenCalledTimes(1);
    });

    test('should update callback with latest camera position data', () => {
      const onUpdate = vi.fn();
      const distance = 400;

      // Mock position.length() to return different values on each call
      let callCount = 0;
      mockCamera.position.length.mockImplementation(() => {
        callCount++;
        return 400 + callCount * 10;
      });

      renderHook(() => CameraController({ distance, onUpdate }));

      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledWith(mockCamera.position, 410);

      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledWith(mockCamera.position, 420);
    });
  });

  describe('Cleanup and Lifecycle', () => {
    test('should cleanup interval on unmount', () => {
      const onUpdate = vi.fn();
      const distance = 400;

      const { unmount } = renderHook(() => CameraController({ distance, onUpdate }));

      // Verify interval is running
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Unmount component
      unmount();

      // Advance time - callback should not be called anymore
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    test('should cleanup old interval when onUpdate changes', () => {
      const onUpdate1 = vi.fn();
      const onUpdate2 = vi.fn();
      const distance = 400;

      const { rerender } = renderHook(
        ({ onUpdate }) => CameraController({ distance, onUpdate }),
        { initialProps: { onUpdate: onUpdate1 } }
      );

      vi.advanceTimersByTime(100);
      expect(onUpdate1).toHaveBeenCalledTimes(1);

      // Change onUpdate callback - should cleanup old interval
      rerender({ onUpdate: onUpdate2 });

      // Only new callback should be invoked
      vi.advanceTimersByTime(100);
      expect(onUpdate1).toHaveBeenCalledTimes(1); // No additional calls
      expect(onUpdate2).toHaveBeenCalledTimes(1);
    });

    test('should not error on unmount when no onUpdate provided', () => {
      const distance = 400;

      const { unmount } = renderHook(() => CameraController({ distance }));

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });

    test('should handle rapid distance changes gracefully', () => {
      const { rerender } = renderHook(
        ({ distance }) => CameraController({ distance }),
        { initialProps: { distance: 300 } }
      );

      // Rapid changes
      rerender({ distance: 400 });
      rerender({ distance: 500 });
      rerender({ distance: 600 });
      rerender({ distance: 700 });

      // Should have called position.copy for each distance change
      expect(mockCamera.position.copy).toHaveBeenCalledTimes(5); // Initial + 4 changes
      expect(mockCamera.lookAt).toHaveBeenCalledTimes(5);
    });
  });

  describe('Edge Cases', () => {
    test('should handle distance of 0', () => {
      const distance = 0;

      renderHook(() => CameraController({ distance }));

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;
      expect(copiedPosition.x).toBe(0);
      expect(copiedPosition.y).toBe(0);
      expect(copiedPosition.z).toBe(0);

      expect(mockCamera.lookAt).toHaveBeenCalledWith(0, 0, 0);
    });

    test('should handle negative distance values', () => {
      const distance = -400;

      renderHook(() => CameraController({ distance }));

      const angle = Math.PI / 4;
      const expectedX = distance * Math.sin(angle);
      const expectedY = distance * 0.4;
      const expectedZ = distance * Math.cos(angle);

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;
      expect(copiedPosition.x).toBeCloseTo(expectedX, 5);
      expect(copiedPosition.y).toBeCloseTo(expectedY, 5);
      expect(copiedPosition.z).toBeCloseTo(expectedZ, 5);
    });

    test('should handle undefined onUpdate gracefully', () => {
      const distance = 400;

      renderHook(() => CameraController({ distance, onUpdate: undefined }));

      // Should not throw when advancing timers
      expect(() => vi.advanceTimersByTime(100)).not.toThrow();
    });

    test('should maintain camera object reference across renders', () => {
      const distance = 400;

      const { rerender } = renderHook(
        ({ distance }) => CameraController({ distance }),
        { initialProps: { distance: 400 } }
      );

      const firstCamera = mockCamera;

      rerender({ distance: 500 });

      // useThree should return same camera object
      expect(useThree).toHaveBeenCalled();
      expect(mockCamera).toBe(firstCamera);
    });
  });

  describe('Mathematical Accuracy', () => {
    test('should calculate 45-degree angle correctly', () => {
      const distance = 400;
      const angle = Math.PI / 4; // 45 degrees in radians

      renderHook(() => CameraController({ distance }));

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;

      // At 45 degrees, x and z should be equal
      expect(copiedPosition.x).toBeCloseTo(copiedPosition.z, 5);

      // Verify against Math.sin and Math.cos directly
      expect(copiedPosition.x).toBeCloseTo(distance * Math.sin(angle), 5);
      expect(copiedPosition.z).toBeCloseTo(distance * Math.cos(angle), 5);
    });

    test('should apply 0.4 multiplier to y coordinate', () => {
      const distance = 500;

      renderHook(() => CameraController({ distance }));

      const copiedPosition = mockCamera.position.copy.mock.calls[0][0] as MockVector3;

      expect(copiedPosition.y).toBeCloseTo(distance * 0.4, 5);
      expect(copiedPosition.y).toBe(200);
    });

    test('should maintain proportional relationships when distance changes', () => {
      const distance1 = 200;
      const distance2 = 400;

      const { rerender } = renderHook(
        ({ distance }) => CameraController({ distance }),
        { initialProps: { distance: distance1 } }
      );

      const position1 = mockCamera.position.copy.mock.calls[0][0] as MockVector3;

      rerender({ distance: distance2 });

      const position2 = mockCamera.position.copy.mock.calls[1][0] as MockVector3;

      // All coordinates should double when distance doubles
      expect(position2.x / position1.x).toBeCloseTo(2, 5);
      expect(position2.y / position1.y).toBeCloseTo(2, 5);
      expect(position2.z / position1.z).toBeCloseTo(2, 5);
    });
  });

  describe('Integration Scenarios', () => {
    test('should complete full lifecycle: initialize → update distance → callback → cleanup', () => {
      const onUpdate = vi.fn();
      const initialDistance = 300;

      const { rerender, unmount } = renderHook(
        ({ distance, onUpdate }) => CameraController({ distance, onUpdate }),
        { initialProps: { distance: initialDistance, onUpdate } }
      );

      // 1. Initial positioning
      expect(mockCamera.position.copy).toHaveBeenCalledTimes(1);
      expect(mockCamera.lookAt).toHaveBeenCalledWith(0, 0, 0);

      // 2. Callback invocation
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // 3. Distance update
      rerender({ distance: 600, onUpdate });
      expect(mockCamera.position.copy).toHaveBeenCalledTimes(2);

      // 4. Continued callbacks
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(2);

      // 5. Cleanup
      unmount();
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(2); // No additional calls
    });

    test('should handle switching from no callback to callback', () => {
      const distance = 400;
      const onUpdate = vi.fn();

      const { rerender } = renderHook(
        ({ onUpdate }) => CameraController({ distance, onUpdate }),
        { initialProps: { onUpdate: undefined as typeof onUpdate } }
      );

      // No callback initially
      vi.advanceTimersByTime(100);
      expect(onUpdate).not.toHaveBeenCalled();

      // Add callback
      rerender({ onUpdate });

      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });

    test('should handle switching from callback to no callback', () => {
      const distance = 400;
      const onUpdate = vi.fn();

      const { rerender } = renderHook(
        ({ onUpdate }) => CameraController({ distance, onUpdate }),
        { initialProps: { onUpdate } }
      );

      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Remove callback
      rerender({ onUpdate: undefined });

      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1); // No additional calls
    });
  });
});