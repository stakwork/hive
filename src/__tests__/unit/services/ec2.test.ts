import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mock functions and mutable config must be hoisted — vi.mock() factories are hoisted above imports
const { mockListInstances, mockStartInstance, mockStopInstance, mockSend, mockConfig } =
  vi.hoisted(() => ({
    mockListInstances: vi.fn(),
    mockStartInstance: vi.fn(),
    mockStopInstance: vi.fn(),
    mockSend: vi.fn(),
    mockConfig: { USE_MOCKS: true },
  }));

vi.mock('@/config/env', () => ({ config: mockConfig }));

vi.mock('@/lib/mock/ec2-state', () => ({
  mockEc2State: {
    listInstances: mockListInstances,
    startInstance: mockStartInstance,
    stopInstance: mockStopInstance,
  },
}));

vi.mock('@vercel/functions/oidc', () => ({
  awsCredentialsProvider: vi.fn().mockReturnValue({}),
}));

vi.mock('@aws-sdk/client-ec2', () => ({
  EC2Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  DescribeInstancesCommand: vi.fn().mockImplementation((args: unknown) => args),
  StartInstancesCommand: vi.fn().mockImplementation((args: unknown) => args),
  StopInstancesCommand: vi.fn().mockImplementation((args: unknown) => args),
}));

// Import service at the top level — config is read at call time via the mutable mockConfig object
import {
  listSuperadminInstances,
  startInstance,
  stopInstance,
} from '@/services/ec2';

describe('EC2 Service (USE_MOCKS=true)', () => {
  beforeEach(() => {
    mockConfig.USE_MOCKS = true;
    vi.clearAllMocks();
    mockListInstances.mockReturnValue([
      {
        instanceId: 'i-mock0000000001',
        name: 'swarm-node-1',
        state: 'running',
        instanceType: 't3.medium',
        launchTime: new Date('2026-01-01T00:00:00Z'),
        tags: [{ key: 'Swarm', value: 'superadmin' }],
      },
    ]);
  });

  it('listSuperadminInstances delegates to mockEc2State', async () => {
    const result = await listSuperadminInstances();

    expect(mockListInstances).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].instanceId).toBe('i-mock0000000001');
    expect(result[0].state).toBe('running');
  });

  it('startInstance delegates to mockEc2State', async () => {
    await startInstance('i-mock0000000004');
    expect(mockStartInstance).toHaveBeenCalledWith('i-mock0000000004');
  });

  it('stopInstance delegates to mockEc2State', async () => {
    await stopInstance('i-mock0000000001');
    expect(mockStopInstance).toHaveBeenCalledWith('i-mock0000000001');
  });

  it('does not call AWS SDK when USE_MOCKS=true', async () => {
    await listSuperadminInstances();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('EC2 Service (USE_MOCKS=false)', () => {
  beforeEach(() => {
    mockConfig.USE_MOCKS = false;
    vi.clearAllMocks();
    vi.stubEnv('AWS_REGION', 'us-east-1');
    vi.stubEnv('AWS_ROLE_ARN', 'arn:aws:iam::123456789012:role/test-role');
    mockSend.mockResolvedValue({ Reservations: [] });
  });

  it('listSuperadminInstances constructs DescribeInstancesCommand with correct filter', async () => {
    const { DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');
    await listSuperadminInstances();

    expect(DescribeInstancesCommand).toHaveBeenCalledWith({
      Filters: [{ Name: 'tag:Swarm', Values: ['superadmin'] }],
    });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('startInstance constructs StartInstancesCommand with correct instanceId', async () => {
    mockSend.mockResolvedValueOnce({});
    const { StartInstancesCommand } = await import('@aws-sdk/client-ec2');

    await startInstance('i-real000000001');

    expect(StartInstancesCommand).toHaveBeenCalledWith({ InstanceIds: ['i-real000000001'] });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('stopInstance constructs StopInstancesCommand with correct instanceId', async () => {
    mockSend.mockResolvedValueOnce({});
    const { StopInstancesCommand } = await import('@aws-sdk/client-ec2');

    await stopInstance('i-real000000002');

    expect(StopInstancesCommand).toHaveBeenCalledWith({ InstanceIds: ['i-real000000002'] });
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('listSuperadminInstances maps AWS response to Ec2InstanceInfo shape', async () => {
    mockSend.mockResolvedValueOnce({
      Reservations: [
        {
          Instances: [
            {
              InstanceId: 'i-real000000001',
              State: { Name: 'running' },
              InstanceType: 't3.medium',
              LaunchTime: new Date('2026-01-01T00:00:00Z'),
              Tags: [
                { Key: 'Swarm', Value: 'superadmin' },
                { Key: 'Name', Value: 'prod-node-1' },
              ],
            },
          ],
        },
      ],
    });

    const result = await listSuperadminInstances();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      instanceId: 'i-real000000001',
      name: 'prod-node-1',
      state: 'running',
      instanceType: 't3.medium',
    });
    expect(result[0].tags).toContainEqual({ key: 'Swarm', value: 'superadmin' });
  });

  it('does not call mockEc2State when USE_MOCKS=false', async () => {
    await listSuperadminInstances();
    expect(mockListInstances).not.toHaveBeenCalled();
  });
});
