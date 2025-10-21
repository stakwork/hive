import { vi } from 'vitest';

/**
 * Mock THREE.Vector3 class
 */
export class MockVector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  copy(v: MockVector3) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  clone() {
    return new MockVector3(this.x, this.y, this.z);
  }
}

/**
 * Create a mock Vector3 instance with optional coordinates
 */
export const mockVector3 = (x = 0, y = 0, z = 0) => {
  return new MockVector3(x, y, z);
};

/**
 * Mock THREE.Box3 class
 */
export const mockBox3 = () => ({
  min: new MockVector3(),
  max: new MockVector3(),
  getCenter: vi.fn((target: MockVector3) => {
    target.set(0, 0, 0);
    return target;
  }),
  getSize: vi.fn((target: MockVector3) => {
    target.set(100, 100, 100);
    return target;
  }),
});

/**
 * Reset all Three.js mocks
 */
export const resetThreeMocks = () => {
  vi.clearAllMocks();
};