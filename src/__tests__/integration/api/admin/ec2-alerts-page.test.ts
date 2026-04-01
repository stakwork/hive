import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace, createTestSwarm } from "@/__tests__/support/factories";

describe("Admin workspace detail — ec2Alert DB query logic", () => {
  const ec2Id = `i-test-page-${Date.now()}`;
  let workspaceWithAlert: Awaited<ReturnType<typeof createTestWorkspace>>;
  let workspaceNoAlert: Awaited<ReturnType<typeof createTestWorkspace>>;
  let workspaceNoSwarm: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    const owner = await createTestUser({ email: `owner-${Date.now()}@test.com` });

    // Workspace whose swarm has a matching Ec2Alert
    workspaceWithAlert = await createTestWorkspace({ name: `ws-with-alert-${Date.now()}`, ownerId: owner.id });
    await createTestSwarm({ workspaceId: workspaceWithAlert.id, name: `swarm-alert-${Date.now()}`, ec2Id });

    await db.ec2Alert.deleteMany({ where: { instanceId: ec2Id } });
    await db.ec2Alert.create({
      data: {
        instanceId: ec2Id,
        alarmName: "high-cpu-alarm",
        alarmState: "ALARM",
        alarmType: "high-cpu",
        stateReason: "CPU above threshold",
        triggeredAt: new Date("2026-03-02T20:00:00.000Z"),
      },
    });

    // Workspace whose swarm has a different ec2Id — no matching alert
    const otherEc2Id = `i-no-match-${Date.now()}`;
    workspaceNoAlert = await createTestWorkspace({ name: `ws-no-alert-${Date.now()}`, ownerId: owner.id });
    await createTestSwarm({ workspaceId: workspaceNoAlert.id, name: `swarm-no-alert-${Date.now()}`, ec2Id: otherEc2Id });

    // Workspace with no swarm at all
    workspaceNoSwarm = await createTestWorkspace({ name: `ws-no-swarm-${Date.now()}`, ownerId: owner.id });
  });

  it("returns alert data when swarm ec2Id matches an Ec2Alert record", async () => {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceWithAlert.id },
      select: { swarm: { select: { ec2Id: true } } },
    });

    const ec2Alert = workspace?.swarm?.ec2Id
      ? await db.ec2Alert.findUnique({ where: { instanceId: workspace.swarm.ec2Id } })
      : null;

    expect(ec2Alert).not.toBeNull();
    expect(ec2Alert!.instanceId).toBe(ec2Id);
    expect(ec2Alert!.alarmState).toBe("ALARM");
    expect(ec2Alert!.alarmType).toBe("high-cpu");
  });

  it("returns null when swarm ec2Id has no matching Ec2Alert", async () => {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceNoAlert.id },
      select: { swarm: { select: { ec2Id: true } } },
    });

    const ec2Alert = workspace?.swarm?.ec2Id
      ? await db.ec2Alert.findUnique({ where: { instanceId: workspace.swarm.ec2Id } })
      : null;

    expect(ec2Alert).toBeNull();
  });

  it("returns null gracefully when workspace has no swarm", async () => {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceNoSwarm.id },
      select: { swarm: { select: { ec2Id: true } } },
    });

    const ec2Alert = workspace?.swarm?.ec2Id
      ? await db.ec2Alert.findUnique({ where: { instanceId: workspace.swarm.ec2Id } })
      : null;

    expect(ec2Alert).toBeNull();
  });
});
