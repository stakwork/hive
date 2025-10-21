import { vi } from 'vitest';

/**
 * Mock camera object with position and methods used by CameraController
 */
export const createMockCamera = () => ({
  position: {
    x: 0,
    y: 0,
    z: 0,
    copy: vi.fn(),
    set: vi.fn(),
    length: vi.fn(() => 100),
  },
  lookAt: vi.fn(),
  updateProjectionMatrix: vi.fn(),
});

/**
 * Mock useThree hook return value
 */
export const mockUseThree = (overrides = {}) => ({
  camera: createMockCamera(),
  viewport: { width: 1024, height: 768, aspect: 1024 / 768 },
  scene: {},
  gl: {},
  size: { width: 1024, height: 768 },
  ...overrides,
});

/**
 * Reset all React Three Fiber mocks
 */
export const resetReactThreeFiberMocks = () => {
  vi.clearAllMocks();
};