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
      if (!instance.InstanceId) continue;

      const tags = (instance.Tags ?? []).map((t) => ({
        key: t.Key ?? '',
        value: t.Value ?? '',
      }));

      const nameTag = tags.find((t) => t.key === 'Name');

      instances.push({
        instanceId: instance.InstanceId,
        name: nameTag?.value ?? instance.InstanceId,
        state: instance.State?.Name ?? 'unknown',
        instanceType: instance.InstanceType ?? 'unknown',
        launchTime: instance.LaunchTime ?? null,
        tags,
        publicIp: instance.PublicIpAddress ?? null,
        privateIp: instance.PrivateIpAddress ?? null,
        hiveWorkspace: null,
      });
    }
  }

  return instances;
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
