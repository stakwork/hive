import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
} from '@aws-sdk/client-ec2';
import { awsCredentialsProvider } from '@vercel/functions/oidc';
import { config } from '@/config/env';
import { mockEc2State, type MockEc2Instance } from '@/lib/mock/ec2-state';

export interface Ec2InstanceInfo {
  instanceId: string;
  name: string;
  state: string;
  instanceType: string;
  launchTime: Date | null;
  tags: { key: string; value: string }[];
  publicIp: string | null;
  privateIp: string | null;
  hiveWorkspace: { name: string; slug: string } | null;
}

function getEc2Client(): EC2Client {
  const region = process.env.AWS_REGION || 'us-east-1';
  const roleArn = process.env.AWS_ROLE_ARN;

  if (!roleArn) {
    throw new Error('Missing required environment variable: AWS_ROLE_ARN');
  }

  return new EC2Client({
    region,
    credentials: awsCredentialsProvider({ roleArn }),
  });
}

function mapMockInstance(inst: MockEc2Instance): Ec2InstanceInfo {
  return {
    instanceId: inst.instanceId,
    name: inst.name,
    state: inst.state,
    instanceType: inst.instanceType,
    launchTime: inst.launchTime,
    tags: inst.tags.map((t) => ({ key: t.key, value: t.value })),
    publicIp: inst.publicIp,
    privateIp: inst.privateIp,
    hiveWorkspace: null,
  };
}

function mapAwsInstance(instance: {
  InstanceId?: string;
  State?: { Name?: string };
  InstanceType?: string;
  LaunchTime?: Date;
  Tags?: { Key?: string; Value?: string }[];
  PublicIpAddress?: string;
  PrivateIpAddress?: string;
}): Ec2InstanceInfo | null {
  if (!instance.InstanceId) return null;

  const tags = (instance.Tags ?? []).map((t) => ({
    key: t.Key ?? '',
    value: t.Value ?? '',
  }));

  const nameTag = tags.find((t) => t.key === 'Name');

  return {
    instanceId: instance.InstanceId,
    name: nameTag?.value ?? instance.InstanceId,
    state: instance.State?.Name ?? 'unknown',
    instanceType: instance.InstanceType ?? 'unknown',
    launchTime: instance.LaunchTime ?? null,
    tags,
    publicIp: instance.PublicIpAddress ?? null,
    privateIp: instance.PrivateIpAddress ?? null,
    hiveWorkspace: null,
  };
}

function isInvalidInstanceIdError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: string; Code?: string; code?: string };
  const identifiers = [candidate.name, candidate.Code, candidate.code];
  return identifiers.some(
    (id) =>
      id === 'InvalidInstanceID.NotFound' ||
      id === 'InvalidInstanceID.Malformed' ||
      id === 'InvalidInstanceIDNotFound' ||
      id === 'InvalidInstanceIDMalformed',
  );
}

export async function listSuperadminInstances(): Promise<Ec2InstanceInfo[]> {
  if (config.USE_MOCKS) {
    return mockEc2State.listInstances().map(mapMockInstance);
  }

  const client = getEc2Client();
  const command = new DescribeInstancesCommand({
    Filters: [{ Name: 'tag:Swarm', Values: ['superadmin'] }],
  });

  const response = await client.send(command);
  const instances: Ec2InstanceInfo[] = [];

  for (const reservation of response.Reservations ?? []) {
    for (const instance of reservation.Instances ?? []) {
      const mapped = mapAwsInstance(instance);
      if (mapped) instances.push(mapped);
    }
  }

  return instances;
}

export async function describeInstance(instanceId: string): Promise<Ec2InstanceInfo | null> {
  if (config.USE_MOCKS) {
    const inst = mockEc2State.listInstances().find((i) => i.instanceId === instanceId);
    return inst ? mapMockInstance(inst) : null;
  }

  const client = getEc2Client();
  try {
    const response = await client.send(
      new DescribeInstancesCommand({
        InstanceIds: [instanceId],
        Filters: [{ Name: 'tag:Swarm', Values: ['superadmin'] }],
      }),
    );

    for (const reservation of response.Reservations ?? []) {
      for (const instance of reservation.Instances ?? []) {
        const mapped = mapAwsInstance(instance);
        if (mapped) return mapped;
      }
    }

    return null;
  } catch (error) {
    if (isInvalidInstanceIdError(error)) {
      return null;
    }
    throw error;
  }
}

export async function startInstance(instanceId: string): Promise<void> {
  if (config.USE_MOCKS) {
    mockEc2State.startInstance(instanceId);
    return;
  }

  const client = getEc2Client();
  await client.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
}

export async function stopInstance(instanceId: string): Promise<void> {
  if (config.USE_MOCKS) {
    mockEc2State.stopInstance(instanceId);
    return;
  }

  const client = getEc2Client();
  await client.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
}
