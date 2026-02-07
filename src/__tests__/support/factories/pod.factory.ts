import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

export interface CreatePodOptions {
  podId?: string;
  swarmId: string;
  password?: string;
  portMappings?: number[];
  status?: PodStatus;
  usageStatus?: PodUsageStatus;
}

// Counter to ensure unique pod IDs when creating multiple pods rapidly
let podCounter = 0;

/**
 * Create a test pod in the database
 */
export async function createTestPod(options: CreatePodOptions) {
  const encryptionService = EncryptionService.getInstance();
  
  // Use counter + timestamp + random to ensure uniqueness even when called rapidly
  const podId = options.podId || `test-pod-${Date.now()}-${podCounter++}-${Math.random().toString(36).substring(7)}`;
  const password = options.password || "test-password-123";
  const portMappings = options.portMappings || [3000, 3010, 15551, 15552];

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
