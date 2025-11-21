import { test } from "@/__tests__/e2e/support/fixtures/test-hooks";
import { AuthPage, DashboardPage, WorkspaceSettingsPage } from "@/__tests__/e2e/support/page-objects";
import { createInvitableUser } from "@/__tests__/e2e/support/fixtures/e2e-scenarios";
import { WorkspaceRole } from "@/lib/auth/roles";

/**
 * Workspace member management journey tests.
 * Covers inviting a member, updating their role, and removing them.
 */
test.describe("Workspace Member Management", () => {
  let authPage: AuthPage;
  let dashboardPage: DashboardPage;
  let settingsPage: WorkspaceSettingsPage;
  let workspaceSlug: string;
  let inviteeUsername: string;

  test.beforeEach(async ({ page }) => {
    inviteeUsername = `e2e-member-${Date.now()}`;
    await createInvitableUser({ githubUsername: inviteeUsername });

    authPage = new AuthPage(page);
    dashboardPage = new DashboardPage(page);
    settingsPage = new WorkspaceSettingsPage(page);

    await authPage.goto();
    await authPage.signInWithMock();
    await dashboardPage.waitForLoad();
    workspaceSlug = authPage.getCurrentWorkspaceSlug();
    await settingsPage.goto(workspaceSlug);
    await settingsPage.waitForLoad();
  });

  test("owner can invite, update, and remove workspace members", async ({ page }) => {
    await test.step("invite a new member as PM", async () => {
      await settingsPage.inviteMember({
        githubUsername: inviteeUsername,
        role: WorkspaceRole.PM,
      });

      await settingsPage.expectMemberVisible(inviteeUsername);
      await settingsPage.expectMemberRole(inviteeUsername, WorkspaceRole.PM);
    });

    await test.step("update the member role to Admin", async () => {
      await settingsPage.changeMemberRole(inviteeUsername, WorkspaceRole.ADMIN);
      await settingsPage.expectMemberRole(inviteeUsername, WorkspaceRole.ADMIN);
    });

    await test.step("downgrade the member role to Viewer", async () => {
      await settingsPage.changeMemberRole(inviteeUsername, WorkspaceRole.VIEWER);
      await settingsPage.expectMemberRole(inviteeUsername, WorkspaceRole.VIEWER);
    });

    await test.step("persist member visibility after page reload", async () => {
      await page.reload();
      await settingsPage.waitForLoad();
      await settingsPage.expectMemberVisible(inviteeUsername);
      await settingsPage.expectMemberRole(inviteeUsername, WorkspaceRole.VIEWER);
    });

    await test.step("remove the member and verify list updates", async () => {
      await settingsPage.removeMember(inviteeUsername);
      await settingsPage.expectMemberAbsent(inviteeUsername);
    });
  });
});
