/**
 * Mock state manager for EC2 instances
 * Provides in-memory state management for EC2 instances during testing and development
 */

export type Ec2InstanceState = 'running' | 'stopped' | 'pending' | 'stopping' | 'terminated';

export interface MockEc2Tag {
  key: string;
  value: string;
}

export interface MockEc2Instance {
  instanceId: string;
  name: string;
  state: Ec2InstanceState;
  instanceType: string;
  launchTime: Date;
  tags: MockEc2Tag[];
}

const INITIAL_INSTANCES: MockEc2Instance[] = [
  {
    instanceId: 'i-mock0000000001',
    name: 'swarm-node-1',
    state: 'running',
    instanceType: 't3.medium',
    launchTime: new Date('2026-01-01T00:00:00Z'),
    tags: [
      { key: 'Swarm', value: 'superadmin' },
      { key: 'Name', value: 'swarm-node-1' },
      { key: 'Environment', value: 'production' },
    ],
  },
  {
    instanceId: 'i-mock0000000002',
    name: 'swarm-node-2',
    state: 'running',
    instanceType: 't3.medium',
    launchTime: new Date('2026-01-02T00:00:00Z'),
    tags: [
      { key: 'Swarm', value: 'superadmin' },
      { key: 'Name', value: 'swarm-node-2' },
      { key: 'Environment', value: 'production' },
    ],
  },
  {
    instanceId: 'i-mock0000000003',
    name: 'swarm-node-3',
    state: 'running',
    instanceType: 't3.large',
    launchTime: new Date('2026-01-03T00:00:00Z'),
    tags: [
      { key: 'Swarm', value: 'superadmin' },
      { key: 'Name', value: 'swarm-node-3' },
      { key: 'Environment', value: 'staging' },
    ],
  },
  {
    instanceId: 'i-mock0000000004',
    name: 'swarm-node-4',
    state: 'stopped',
    instanceType: 't3.medium',
    launchTime: new Date('2026-01-04T00:00:00Z'),
    tags: [
      { key: 'Swarm', value: 'superadmin' },
      { key: 'Name', value: 'swarm-node-4' },
      { key: 'Environment', value: 'staging' },
    ],
  },
  {
    instanceId: 'i-mock0000000005',
    name: 'swarm-node-5',
    state: 'pending',
    instanceType: 't3.small',
    launchTime: new Date('2026-01-05T00:00:00Z'),
    tags: [
      { key: 'Swarm', value: 'superadmin' },
      { key: 'Name', value: 'swarm-node-5' },
      { key: 'Environment', value: 'development' },
    ],
  },
];

/**
 * Singleton class to manage mock EC2 state across requests.
 * Mirrors the pattern used by MockSwarmStateManager in swarm-state.ts.
 */
class MockEc2StateManager {
  private instances: Map<string, MockEc2Instance>;

  constructor() {
    this.instances = new Map(
      INITIAL_INSTANCES.map((inst) => [inst.instanceId, { ...inst }])
    );
  }

  listInstances(): MockEc2Instance[] {
    return Array.from(this.instances.values());
  }

  startInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    if (instance.state === 'stopped') {
      instance.state = 'running';
    }
    // noop if already running or in a transitional state
  }

  stopInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    if (instance.state === 'running') {
      instance.state = 'stopped';
    }
    // noop if already stopped or in a transitional state
  }

  /** Resets all instances to their initial state — used in tests */
  reset(): void {
    this.instances = new Map(
      INITIAL_INSTANCES.map((inst) => [inst.instanceId, { ...inst, tags: [...inst.tags] }])
    );
  }
}

export const mockEc2State = new MockEc2StateManager();
