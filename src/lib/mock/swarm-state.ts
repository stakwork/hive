/**
 * Mock state manager for Swarm Super Admin service
 * Provides in-memory state management for swarm instances during testing and development
 */

export type SwarmStatus = "PENDING" | "RUNNING" | "STOPPED" | "FAILED";

export interface MockSwarm {
  swarm_id: string;
  ec2_id: string;
  address: string;
  x_api_key: string;
  instance_type: string;
  password: string;
  status: SwarmStatus;
  createdAt: Date;
  updatedAt: Date;
  statusTransitionTimer?: NodeJS.Timeout;
}

export interface MockDomainCheck {
  domain: string;
  available: boolean;
}

/**
 * Singleton class to manage mock swarm state across requests
 * Follows the same pattern as MockStakworkStateManager and MockPoolStateManager
 */
class MockSwarmStateManager {
  private swarms: Map<string, MockSwarm>;
  private domains: Set<string>;
  private swarmIdCounter: number;
  private ec2IdCounter: number;

  constructor() {
    this.swarms = new Map();
    this.domains = new Set();
    this.swarmIdCounter = 1;
    this.ec2IdCounter = 1;
  }

  /**
   * Create a new mock swarm instance
   * Auto-generates unique IDs and simulates async status transitions
   */
  createSwarm(input: {
    instance_type: string;
    password?: string;
  }): {
    swarm_id: string;
    address: string;
    x_api_key: string;
    ec2_id: string;
  } {
    const swarmId = `mock-swarm-${this.swarmIdCounter.toString().padStart(6, "0")}`;
    const ec2Id = `i-mock${this.ec2IdCounter.toString().padStart(10, "0")}`;
    const address = `${swarmId}.test.local`;
    const apiKey = `mock-api-key-${this.generateRandomString(8)}`;

    this.swarmIdCounter++;
    this.ec2IdCounter++;

    const swarm: MockSwarm = {
      swarm_id: swarmId,
      ec2_id: ec2Id,
      address,
      x_api_key: apiKey,
      instance_type: input.instance_type,
      password: input.password || this.generateRandomString(16),
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.swarms.set(swarmId, swarm);
    this.domains.add(swarmId);

    // Schedule status transition to RUNNING after 2 seconds
    this.scheduleStatusTransition(swarmId);

    return {
      swarm_id: swarmId,
      address,
      x_api_key: apiKey,
      ec2_id: ec2Id,
    };
  }

  /**
   * Get swarm details by ID
   * Auto-creates swarm if it doesn't exist (for resilience in tests)
   */
  getSwarmDetails(swarmId: string): MockSwarm {
    let swarm = this.swarms.get(swarmId);

    if (!swarm) {
      // Auto-create swarm if not found (following mock pattern)
      const created = this.createSwarm({
        instance_type: "t3.small",
      });

      swarm = this.swarms.get(created.swarm_id);
      if (!swarm) {
        throw new Error("Failed to auto-create swarm");
      }
    }

    return swarm;
  }

  /**
   * Stop a swarm by EC2 instance ID
   */
  stopSwarm(ec2Id: string): { success: boolean; message: string } {
    const swarm = Array.from(this.swarms.values()).find(
      (s) => s.ec2_id === ec2Id
    );

    if (!swarm) {
      return {
        success: false,
        message: `Swarm with EC2 ID ${ec2Id} not found`,
      };
    }

    // Clear any pending status transition timers
    if (swarm.statusTransitionTimer) {
      clearTimeout(swarm.statusTransitionTimer);
      delete swarm.statusTransitionTimer;
    }

    swarm.status = "STOPPED";
    swarm.updatedAt = new Date();

    return {
      success: true,
      message: "Swarm stopped successfully",
    };
  }

  /**
   * Check if a domain name is available
   */
  checkDomain(domain: string): {
    domain_exists: boolean;
    swarm_name_exist: boolean;
  } {
    const exists = this.domains.has(domain);

    return {
      domain_exists: exists,
      swarm_name_exist: exists,
    };
  }

  /**
   * Get all swarms (useful for debugging and tests)
   */
  getAllSwarms(): MockSwarm[] {
    return Array.from(this.swarms.values());
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    // Clear all timers
    this.swarms.forEach((swarm) => {
      if (swarm.statusTransitionTimer) {
        clearTimeout(swarm.statusTransitionTimer);
      }
    });

    this.swarms.clear();
    this.domains.clear();
    this.swarmIdCounter = 1;
    this.ec2IdCounter = 1;
  }

  /**
   * Schedule a status transition from PENDING to RUNNING
   * Simulates async infrastructure provisioning
   */
  private scheduleStatusTransition(swarmId: string): void {
    const timer = setTimeout(() => {
      const swarm = this.swarms.get(swarmId);
      if (swarm && swarm.status === "PENDING") {
        swarm.status = "RUNNING";
        swarm.updatedAt = new Date();
        delete swarm.statusTransitionTimer;
      }
    }, 2000);

    const swarm = this.swarms.get(swarmId);
    if (swarm) {
      swarm.statusTransitionTimer = timer;
    }
  }

  /**
   * Generate a random string for IDs and tokens
   */
  private generateRandomString(length: number): string {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// Export singleton instance
export const mockSwarmState = new MockSwarmStateManager();