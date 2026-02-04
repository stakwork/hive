import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

export interface CreatePodOptions {
  podId?: string;
  swarmId: string;
  password?: string;
  portMappings?: Record<string, number>;
  status?: PodStatus;
  usageStatus?: PodUsageStatus;
}

/**
 * Create a test pod in the database
 */
export async function createTestPod(options: CreatePodOptions) {
  const encryptionService = EncryptionService.getInstance();
  
  const podId = options.podId || `test-pod-${Date.now()}`;
  const password = options.password || "test-password-123";
  const portMappings = options.portMappings || {
    "3000": 30000,
    "3010": 30010,
    "15551": 31551,
    "15552": 31552,
  };

  // Encrypt password
  const encryptedPassword = encryptionService.encryptField("password", password);

  const pod = await db.pod.create({
    data: {
      podId,
      swarmId: options.swarmId,
      password: JSON.stringify(encryptedPassword),
      portMappings: portMappings,
      status: options.status || PodStatus.RUNNING,
      usageStatus: options.usageStatus || PodUsageStatus.UNUSED,
    },
  });

  return pod;
}

/**
 * Create multiple test pods for a swarm
 */
export async function createTestPods(swarmId: string, count: number) {
  const pods = [];
  
  for (let i = 0; i < count; i++) {
    const pod = await createTestPod({
      podId: `test-pod-${Date.now()}-${i}`,
      swarmId,
    });
    pods.push(pod);
  }
  
  return pods;
}
