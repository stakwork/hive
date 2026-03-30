import { describe, it, expect, beforeEach } from 'vitest';
import { mockEc2State } from '@/lib/mock/ec2-state';

describe('MockEc2StateManager', () => {
  beforeEach(() => {
    mockEc2State.reset();
  });

  describe('listInstances', () => {
    it('returns 5 pre-seeded instances', () => {
      const instances = mockEc2State.listInstances();
      expect(instances).toHaveLength(5);
    });

    it('has 3 running, 1 stopped, 1 pending', () => {
      const instances = mockEc2State.listInstances();
      const byState = instances.reduce<Record<string, number>>((acc, inst) => {
        acc[inst.state] = (acc[inst.state] ?? 0) + 1;
        return acc;
      }, {});
      expect(byState['running']).toBe(3);
      expect(byState['stopped']).toBe(1);
      expect(byState['pending']).toBe(1);
    });

    it('each instance has required fields', () => {
      const instances = mockEc2State.listInstances();
      for (const inst of instances) {
        expect(inst.instanceId).toBeTruthy();
        expect(inst.name).toBeTruthy();
        expect(inst.state).toBeTruthy();
        expect(inst.instanceType).toBeTruthy();
        expect(inst.launchTime).toBeInstanceOf(Date);
        expect(Array.isArray(inst.tags)).toBe(true);
      }
    });
  });

  describe('stopInstance', () => {
    it('transitions running → stopped', () => {
      mockEc2State.stopInstance('i-mock0000000001');
      const inst = mockEc2State.listInstances().find((i) => i.instanceId === 'i-mock0000000001');
      expect(inst?.state).toBe('stopped');
    });

    it('is a noop if already stopped', () => {
      mockEc2State.stopInstance('i-mock0000000004');
      const inst = mockEc2State.listInstances().find((i) => i.instanceId === 'i-mock0000000004');
      expect(inst?.state).toBe('stopped');
    });

    it('is a noop for pending state', () => {
      mockEc2State.stopInstance('i-mock0000000005');
      const inst = mockEc2State.listInstances().find((i) => i.instanceId === 'i-mock0000000005');
      expect(inst?.state).toBe('pending');
    });

    it('is a noop for unknown instanceId', () => {
      expect(() => mockEc2State.stopInstance('i-does-not-exist')).not.toThrow();
    });
  });

  describe('startInstance', () => {
    it('transitions stopped → running', () => {
      mockEc2State.startInstance('i-mock0000000004');
      const inst = mockEc2State.listInstances().find((i) => i.instanceId === 'i-mock0000000004');
      expect(inst?.state).toBe('running');
    });

    it('is a noop if already running', () => {
      mockEc2State.startInstance('i-mock0000000001');
      const inst = mockEc2State.listInstances().find((i) => i.instanceId === 'i-mock0000000001');
      expect(inst?.state).toBe('running');
    });

    it('is a noop for pending state', () => {
      mockEc2State.startInstance('i-mock0000000005');
      const inst = mockEc2State.listInstances().find((i) => i.instanceId === 'i-mock0000000005');
      expect(inst?.state).toBe('pending');
    });

    it('is a noop for unknown instanceId', () => {
      expect(() => mockEc2State.startInstance('i-does-not-exist')).not.toThrow();
    });
  });

  describe('reset', () => {
    it('restores initial state after mutations', () => {
      mockEc2State.stopInstance('i-mock0000000001');
      mockEc2State.startInstance('i-mock0000000004');
      mockEc2State.reset();

      const instances = mockEc2State.listInstances();
      const inst1 = instances.find((i) => i.instanceId === 'i-mock0000000001');
      const inst4 = instances.find((i) => i.instanceId === 'i-mock0000000004');
      expect(inst1?.state).toBe('running');
      expect(inst4?.state).toBe('stopped');
    });
  });
});
