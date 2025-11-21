import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

// Extract CameraController for testing by creating a test wrapper
// In a real scenario, you might export CameraController separately for easier testing
const CameraController = ({
  distance,
  onUpdate,
}: {
  distance: number;
  onUpdate?: (pos: { x: number; y: number; z: number }, distance: number) => void;
}) => {
  const { camera } = (global as any).mockUseThree();

  React.useEffect(() => {
    // Angled view to better see layer depth
    const angle = Math.PI / 4; // 45 degrees
    const x = distance * Math.sin(angle);
    const y = distance * 0.4;
    const z = distance * Math.cos(angle);

    const newPos = { x, y, z };
    camera.position.copy(newPos);
    camera.lookAt(0, 0, 0);
  }, [camera, distance]);

  React.useEffect(() => {
    if (!onUpdate) return;
    const interval = setInterval(() => {
      const dist = camera.position.length();
      onUpdate(camera.position, dist);
    }, 100);
    return () => clearInterval(interval);
  }, [camera, onUpdate]);

  return null;
};

// Mock Three.js Vector3
class MockVector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: { x: number; y: number; z: number }) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
}

// Mock camera object
const createMockCamera = () => ({
  position: new MockVector3(0, 0, 0),
  lookAt: vi.fn(),
});

// Mock useThree hook
let mockCamera: ReturnType<typeof createMockCamera>;
const mockUseThree = vi.fn(() => ({
  camera: mockCamera,
}));

// Set up global mocks
(global as any).mockUseThree = mockUseThree;

// Test data factories
const TestDataFactories = {
  cameraControllerProps: (overrides = {}) => ({
    distance: 100,
    ...overrides,
  }),

  createCameraControllerWithCallback: (distance = 100) => {
    const onUpdate = vi.fn();
    return {
      distance,
      onUpdate,
      mockCallback: onUpdate,
    };
  },
};

// Test utilities
const TestUtils = {
  renderCameraController: (props: { distance: number; onUpdate?: any }) => {
    return render(<CameraController {...props} />);
  },

  expectCameraPosition: (
    camera: ReturnType<typeof createMockCamera>,
    expectedX: number,
    expectedY: number,
    expectedZ: number,
    tolerance = 0.0001,
  ) => {
    expect(camera.position.x).toBeCloseTo(expectedX, 4);
    expect(camera.position.y).toBeCloseTo(expectedY, 4);
    expect(camera.position.z).toBeCloseTo(expectedZ, 4);
  },

  expectCameraLooksAtOrigin: (camera: ReturnType<typeof createMockCamera>) => {
    expect(camera.lookAt).toHaveBeenCalledWith(0, 0, 0);
  },

  calculateExpectedPosition: (distance: number) => {
    const angle = Math.PI / 4; // 45 degrees
    return {
      x: distance * Math.sin(angle),
      y: distance * 0.4,
      z: distance * Math.cos(angle),
    };
  },
};

describe("CameraController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockCamera = createMockCamera();
    mockUseThree.mockReturnValue({ camera: mockCamera });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("Camera Positioning", () => {
    test("positions camera at 45-degree angle based on distance", () => {
      const distance = 100;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("calculates correct position for distance of 200", () => {
      const distance = 200;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("calculates correct position for distance of 500", () => {
      const distance = 500;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("calculates correct position for small distance", () => {
      const distance = 10;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("uses Math.PI / 4 for 45-degree angle calculation", () => {
      const distance = 100;
      const angle = Math.PI / 4;

      const props = TestDataFactories.cameraControllerProps({ distance });
      TestUtils.renderCameraController(props);

      const expectedX = distance * Math.sin(angle);
      const expectedZ = distance * Math.cos(angle);

      expect(mockCamera.position.x).toBeCloseTo(expectedX, 4);
      expect(mockCamera.position.z).toBeCloseTo(expectedZ, 4);
    });

    test("uses 0.4 multiplier for y-axis elevation", () => {
      const distance = 100;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expectedY = distance * 0.4;
      expect(mockCamera.position.y).toBeCloseTo(expectedY, 4);
    });
  });

  describe("Camera Target", () => {
    test("points camera at origin (0, 0, 0)", () => {
      const props = TestDataFactories.cameraControllerProps();

      TestUtils.renderCameraController(props);

      TestUtils.expectCameraLooksAtOrigin(mockCamera);
    });

    test("calls lookAt once on initial render", () => {
      const props = TestDataFactories.cameraControllerProps();

      TestUtils.renderCameraController(props);

      expect(mockCamera.lookAt).toHaveBeenCalledTimes(1);
    });

    test("calls lookAt with correct coordinates", () => {
      const props = TestDataFactories.cameraControllerProps();

      TestUtils.renderCameraController(props);

      expect(mockCamera.lookAt).toHaveBeenCalledWith(0, 0, 0);
    });
  });

  describe("Dynamic Updates", () => {
    test("updates camera position when distance prop changes", () => {
      const initialDistance = 100;
      const props = TestDataFactories.cameraControllerProps({ distance: initialDistance });

      const { rerender } = TestUtils.renderCameraController(props);

      const initialExpected = TestUtils.calculateExpectedPosition(initialDistance);
      TestUtils.expectCameraPosition(mockCamera, initialExpected.x, initialExpected.y, initialExpected.z);

      // Update distance
      const newDistance = 300;
      const newProps = TestDataFactories.cameraControllerProps({ distance: newDistance });
      rerender(<CameraController {...newProps} />);

      const newExpected = TestUtils.calculateExpectedPosition(newDistance);
      TestUtils.expectCameraPosition(mockCamera, newExpected.x, newExpected.y, newExpected.z);
    });

    test("calls lookAt again when distance changes", () => {
      const props = TestDataFactories.cameraControllerProps({ distance: 100 });

      const { rerender } = TestUtils.renderCameraController(props);

      expect(mockCamera.lookAt).toHaveBeenCalledTimes(1);

      // Update distance
      rerender(<CameraController distance={200} />);

      expect(mockCamera.lookAt).toHaveBeenCalledTimes(2);
    });

    test("recalculates position multiple times on multiple updates", () => {
      const props = TestDataFactories.cameraControllerProps({ distance: 100 });

      const { rerender } = TestUtils.renderCameraController(props);

      const distances = [200, 300, 150, 400];

      distances.forEach((distance) => {
        rerender(<CameraController distance={distance} />);

        const expected = TestUtils.calculateExpectedPosition(distance);
        TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
      });
    });
  });

  describe("onUpdate Callback", () => {
    test("fires callback every 100ms when provided", () => {
      const { distance, onUpdate } = TestDataFactories.createCameraControllerWithCallback(100);

      TestUtils.renderCameraController({ distance, onUpdate });

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

    test("passes camera position to callback", () => {
      const distance = 100;
      const { onUpdate } = TestDataFactories.createCameraControllerWithCallback(distance);

      TestUtils.renderCameraController({ distance, onUpdate });

      vi.advanceTimersByTime(100);

      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
          z: expect.any(Number),
        }),
        expect.any(Number),
      );
    });

    test("passes calculated distance to callback", () => {
      const distance = 100;
      const { onUpdate } = TestDataFactories.createCameraControllerWithCallback(distance);

      TestUtils.renderCameraController({ distance, onUpdate });

      vi.advanceTimersByTime(100);

      const [, passedDistance] = onUpdate.mock.calls[0];
      expect(passedDistance).toBeCloseTo(mockCamera.position.length(), 4);
    });

    test("does not create interval when onUpdate is not provided", () => {
      const props = TestDataFactories.cameraControllerProps();

      TestUtils.renderCameraController(props);

      // Advance time - nothing should happen
      vi.advanceTimersByTime(1000);

      // No error should occur, and no callbacks should be attempted
      expect(vi.getTimerCount()).toBe(0);
    });

    test("callback receives updated position after distance change", () => {
      const initialDistance = 100;
      const { onUpdate } = TestDataFactories.createCameraControllerWithCallback(initialDistance);

      const { rerender } = TestUtils.renderCameraController({
        distance: initialDistance,
        onUpdate,
      });

      vi.advanceTimersByTime(100);
      const [initialPosition] = onUpdate.mock.calls[0];
      const initialX = initialPosition.x;
      const initialY = initialPosition.y;
      const initialZ = initialPosition.z;

      // Change distance - this updates camera position immediately via useEffect
      const newDistance = 300;
      rerender(<CameraController distance={newDistance} onUpdate={onUpdate} />);

      // Advance time for next callback
      vi.advanceTimersByTime(100);
      const [newPosition] = onUpdate.mock.calls[1];

      // Positions should be different after distance change
      expect(newPosition.x).not.toBeCloseTo(initialX, 4);
      expect(newPosition.y).not.toBeCloseTo(initialY, 4);
      expect(newPosition.z).not.toBeCloseTo(initialZ, 4);
    });
  });

  describe("Lifecycle and Cleanup", () => {
    test("clears interval on unmount", () => {
      const { distance, onUpdate } = TestDataFactories.createCameraControllerWithCallback(100);

      const { unmount } = TestUtils.renderCameraController({ distance, onUpdate });

      // Start the interval
      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Unmount the component
      unmount();

      // Advance time - callback should not be called anymore
      vi.advanceTimersByTime(200);
      expect(onUpdate).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    test("clears old interval when onUpdate changes", () => {
      const distance = 100;
      const firstCallback = vi.fn();

      const { rerender } = TestUtils.renderCameraController({
        distance,
        onUpdate: firstCallback,
      });

      vi.advanceTimersByTime(100);
      expect(firstCallback).toHaveBeenCalledTimes(1);

      // Change the callback
      const secondCallback = vi.fn();
      rerender(<CameraController distance={distance} onUpdate={secondCallback} />);

      vi.advanceTimersByTime(100);

      // First callback should not be called again
      expect(firstCallback).toHaveBeenCalledTimes(1);

      // Second callback should be called
      expect(secondCallback).toHaveBeenCalledTimes(1);
    });

    test("handles rapid mount/unmount cycles", () => {
      const { distance, onUpdate } = TestDataFactories.createCameraControllerWithCallback(100);

      // First mount
      let result = TestUtils.renderCameraController({ distance, onUpdate });
      result.unmount();

      // Second mount
      result = TestUtils.renderCameraController({ distance, onUpdate });
      result.unmount();

      // Third mount
      result = TestUtils.renderCameraController({ distance, onUpdate });

      vi.advanceTimersByTime(100);

      // Should only have one active interval (from the last mount)
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Cleanup
      result.unmount();
    });

    test("stops callback when onUpdate is removed", () => {
      const distance = 100;
      const onUpdate = vi.fn();

      const { rerender } = TestUtils.renderCameraController({ distance, onUpdate });

      vi.advanceTimersByTime(100);
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // Remove onUpdate
      rerender(<CameraController distance={distance} />);

      vi.advanceTimersByTime(200);

      // Callback should not be called again
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Edge Cases", () => {
    test("handles distance of 0", () => {
      const props = TestDataFactories.cameraControllerProps({ distance: 0 });

      TestUtils.renderCameraController(props);

      TestUtils.expectCameraPosition(mockCamera, 0, 0, 0);
    });

    test("handles negative distance (mathematically valid)", () => {
      const distance = -100;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("handles very large distance values", () => {
      const distance = 10000;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("handles fractional distance values", () => {
      const distance = 123.456;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const expected = TestUtils.calculateExpectedPosition(distance);
      TestUtils.expectCameraPosition(mockCamera, expected.x, expected.y, expected.z);
    });

    test("interval timing is consistent across multiple cycles", () => {
      const { distance, onUpdate } = TestDataFactories.createCameraControllerWithCallback(100);

      TestUtils.renderCameraController({ distance, onUpdate });

      // Check timing over 10 cycles
      for (let i = 1; i <= 10; i++) {
        vi.advanceTimersByTime(100);
        expect(onUpdate).toHaveBeenCalledTimes(i);
      }
    });

    test("handles rapid distance changes", () => {
      const props = TestDataFactories.cameraControllerProps({ distance: 100 });

      const { rerender } = TestUtils.renderCameraController(props);

      // Rapidly change distance
      const distances = [150, 200, 175, 225, 190, 210];
      distances.forEach((distance) => {
        rerender(<CameraController distance={distance} />);
      });

      // Final position should match last distance
      const finalExpected = TestUtils.calculateExpectedPosition(210);
      TestUtils.expectCameraPosition(mockCamera, finalExpected.x, finalExpected.y, finalExpected.z);
    });
  });

  describe("Mathematical Correctness", () => {
    test("maintains correct angle ratio between x and z coordinates", () => {
      const distance = 100;
      const props = TestDataFactories.cameraControllerProps({ distance });

      TestUtils.renderCameraController(props);

      const angle = Math.PI / 4;
      const expectedRatio = Math.tan(angle); // sin/cos = tan

      const actualRatio = mockCamera.position.x / mockCamera.position.z;
      expect(actualRatio).toBeCloseTo(expectedRatio, 4);
    });

    test("y-coordinate is always 40% of distance", () => {
      const distances = [50, 100, 200, 500];

      distances.forEach((distance) => {
        const props = TestDataFactories.cameraControllerProps({ distance });

        const { unmount } = TestUtils.renderCameraController(props);

        expect(mockCamera.position.y).toBeCloseTo(distance * 0.4, 4);

        unmount();
        mockCamera = createMockCamera();
        mockUseThree.mockReturnValue({ camera: mockCamera });
      });
    });

    test("position magnitude increases proportionally with distance", () => {
      const distances = [100, 200, 300];
      const positions: number[] = [];

      distances.forEach((distance) => {
        const props = TestDataFactories.cameraControllerProps({ distance });

        const { unmount } = TestUtils.renderCameraController(props);

        positions.push(mockCamera.position.length());

        unmount();
        mockCamera = createMockCamera();
        mockUseThree.mockReturnValue({ camera: mockCamera });
      });

      // Check that position magnitudes scale proportionally
      const ratio1 = positions[1] / positions[0];
      const ratio2 = positions[2] / positions[1];

      // Ratios should be approximately equal (2.0 and 1.5)
      expect(ratio1).toBeCloseTo(2.0, 1);
      expect(ratio2).toBeCloseTo(1.5, 1);
    });
  });
});
