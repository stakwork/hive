interface MockBounty {
  id: string;
  title: string;
  description: string;
  owner_id: string;
  price: number; // In satoshis
  created: number; // Unix timestamp
  updated: number;
  assignee: string;
  status: "DRAFT" | "OPEN" | "ASSIGNED" | "PAID" | "COMPLETED";
  bounty_type: "coding_task";
  hive_task_id?: string;
  bounty_code?: string;
  estimated_completion_hours?: number;
  github_description?: string;
}

interface MockUser {
  id: string;
  pubkey: string;
  owner_alias: string;
  owner_contact_key: string;
  img: string;
}

class MockSphinxTribesStateManager {
  private bounties: Map<string, MockBounty> = new Map();
  private users: Map<string, MockUser> = new Map();
  private bountyIdCounter = 1000;
  private userIdCounter = 1;

  constructor() {
    // Initialize with a default user
    this.createUser({
      owner_alias: "HiveUser",
      owner_contact_key: "mock_contact_key",
      img: "/sphinx_icon.png",
    });
  }

  // Bounty operations
  createBounty(input: Partial<MockBounty>): MockBounty {
    const bountyId = `${this.bountyIdCounter++}`;
    const now = Math.floor(Date.now() / 1000);

    const bounty: MockBounty = {
      id: bountyId,
      title: input.title || "Untitled Bounty",
      description: input.description || "",
      owner_id: input.owner_id || "1",
      price: input.price || 1000, // Default 1000 sats
      created: now,
      updated: now,
      assignee: input.assignee || "",
      status: input.status || "OPEN",
      bounty_type: "coding_task",
      hive_task_id: input.hive_task_id,
      bounty_code: input.bounty_code,
      estimated_completion_hours: input.estimated_completion_hours,
      github_description: input.github_description,
    };

    this.bounties.set(bountyId, bounty);
    console.log(`[Mock Sphinx Tribes] Created bounty ${bountyId}:`, bounty.title);
    return bounty;
  }

  getBounty(bountyId: string): MockBounty | undefined {
    return this.bounties.get(bountyId);
  }

  getBountyByCode(bountyCode: string): MockBounty | undefined {
    return Array.from(this.bounties.values()).find(
      (b) => b.bounty_code === bountyCode
    );
  }

  updateBounty(
    bountyId: string,
    updates: Partial<MockBounty>
  ): MockBounty | undefined {
    const bounty = this.bounties.get(bountyId);
    if (!bounty) return undefined;

    const updated = {
      ...bounty,
      ...updates,
      updated: Math.floor(Date.now() / 1000),
    };
    this.bounties.set(bountyId, updated);
    console.log(`[Mock Sphinx Tribes] Updated bounty ${bountyId}`);
    return updated;
  }

  listBounties(filters?: {
    status?: string;
    owner_id?: string;
  }): MockBounty[] {
    let bounties = Array.from(this.bounties.values());

    if (filters?.status) {
      bounties = bounties.filter((b) => b.status === filters.status);
    }
    if (filters?.owner_id) {
      bounties = bounties.filter((b) => b.owner_id === filters.owner_id);
    }

    return bounties.sort((a, b) => b.created - a.created);
  }

  // User operations
  createUser(input: Partial<MockUser>): MockUser {
    const userId = `${this.userIdCounter++}`;
    const user: MockUser = {
      id: userId,
      pubkey: `mock_pubkey_${userId}`,
      owner_alias: input.owner_alias || "Anonymous",
      owner_contact_key: input.owner_contact_key || `contact_${userId}`,
      img: input.img || "/sphinx_icon.png",
    };

    this.users.set(userId, user);
    console.log(`[Mock Sphinx Tribes] Created user ${userId}:`, user.owner_alias);
    return user;
  }

  getUser(userId: string): MockUser | undefined {
    return this.users.get(userId);
  }

  // Test utilities
  reset(): void {
    this.bounties.clear();
    this.users.clear();
    this.bountyIdCounter = 1000;
    this.userIdCounter = 1;

    // Reinitialize default user
    this.createUser({
      owner_alias: "HiveUser",
      owner_contact_key: "mock_contact_key",
      img: "/sphinx_icon.png",
    });

    console.log("[Mock Sphinx Tribes] State reset complete");
  }

  // Debug utilities
  getStats() {
    return {
      bounties: this.bounties.size,
      users: this.users.size,
      nextBountyId: this.bountyIdCounter,
      nextUserId: this.userIdCounter,
    };
  }
}

export const mockSphinxTribesState = new MockSphinxTribesStateManager();
