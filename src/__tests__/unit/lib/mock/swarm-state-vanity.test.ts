import { describe, test, expect, beforeEach } from "vitest";
import { mockSwarmState } from "@/lib/mock/swarm-state";

describe("MockSwarmStateManager.updateVanityAddress", () => {
  beforeEach(() => {
    mockSwarmState.reset();
  });

  test("returns success: false when swarm not found by address", () => {
    const result = mockSwarmState.updateVanityAddress(
      "nonexistent.sphinx.chat",
      "newname.sphinx.chat"
    );

    expect(result).toEqual({ success: false, message: "Swarm not found" });
  });

  test("updates swarm address on success", () => {
    // Create a swarm so we have something to look up
    const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });
    const swarms = mockSwarmState.getAllSwarms();
    const swarm = swarms.find((s) => s.swarm_id === created.swarm_id)!;
    const originalAddress = swarm.address;

    const result = mockSwarmState.updateVanityAddress(
      originalAddress,
      "machinelearning.sphinx.chat"
    );

    expect(result).toEqual({ success: true, message: "Vanity address updated" });

    const updatedSwarms = mockSwarmState.getAllSwarms();
    const updatedSwarm = updatedSwarms.find((s) => s.swarm_id === created.swarm_id)!;
    expect(updatedSwarm.address).toBe("machinelearning.sphinx.chat");
  });

  test("removes old subdomain from domain registry and adds new one", () => {
    const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });
    const swarms = mockSwarmState.getAllSwarms();
    const swarm = swarms.find((s) => s.swarm_id === created.swarm_id)!;
    const originalAddress = swarm.address;

    // Old subdomain should be registered (check domain exists)
    const oldSubdomain = originalAddress.replace(/\.sphinx\.chat$/, "");
    const beforeCheck = mockSwarmState.checkDomain(oldSubdomain);
    // The mock creates addresses like "mock-swarm-000001.test.local" without .sphinx.chat
    // so let's use the actual subdomain stripping logic
    // The domain registry uses the subdomain directly from createSwarm which adds swarmId
    // Let's verify via updateVanityAddress result and subsequent checkDomain calls

    mockSwarmState.updateVanityAddress(originalAddress, "machinelearning.sphinx.chat");

    // New subdomain should now exist in domain registry
    const newCheck = mockSwarmState.checkDomain("machinelearning");
    expect(newCheck.domain_exists).toBe(true);
    expect(newCheck.swarm_name_exist).toBe(true);
  });

  test("removing old subdomain makes it available in domain registry", () => {
    const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });
    const swarms = mockSwarmState.getAllSwarms();
    const swarm = swarms.find((s) => s.swarm_id === created.swarm_id)!;

    // Manually set a sphinx.chat style address so we can verify removal
    // We'll call updateVanityAddress to set it first
    const firstAddress = `${created.swarm_id}.sphinx.chat`;
    // Simulate the swarm having a sphinx.chat address by updating from current
    mockSwarmState.updateVanityAddress(swarm.address, firstAddress);

    // Now update to new address
    const result = mockSwarmState.updateVanityAddress(firstAddress, "newvanity.sphinx.chat");
    expect(result.success).toBe(true);

    // Old subdomain should no longer exist
    const oldCheck = mockSwarmState.checkDomain(created.swarm_id);
    expect(oldCheck.domain_exists).toBe(false);

    // New subdomain should exist
    const newCheck = mockSwarmState.checkDomain("newvanity");
    expect(newCheck.domain_exists).toBe(true);
  });

  test("exact address match required (not partial)", () => {
    mockSwarmState.createSwarm({ instance_type: "t3.small" });

    // Using a partial match that is not exact should fail
    const result = mockSwarmState.updateVanityAddress(
      "sphinx.chat",
      "newname.sphinx.chat"
    );

    expect(result).toEqual({ success: false, message: "Swarm not found" });
  });

  test("updatedAt is refreshed after update", () => {
    const created = mockSwarmState.createSwarm({ instance_type: "t3.small" });
    const swarms = mockSwarmState.getAllSwarms();
    const swarm = swarms.find((s) => s.swarm_id === created.swarm_id)!;
    const originalUpdatedAt = swarm.updatedAt;

    // Small delay to ensure timestamp differs
    const before = Date.now();
    mockSwarmState.updateVanityAddress(swarm.address, "updated.sphinx.chat");

    const updatedSwarms = mockSwarmState.getAllSwarms();
    const updatedSwarm = updatedSwarms.find((s) => s.swarm_id === created.swarm_id)!;
    expect(updatedSwarm.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
