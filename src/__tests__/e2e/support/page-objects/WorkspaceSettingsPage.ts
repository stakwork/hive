import { Page, expect } from '@playwright/test';
import { selectors, dynamicSelectors } from '../fixtures/selectors';
import { WorkspaceRole } from '@/lib/auth/roles';

const roleSelectors: Record<WorkspaceRole, string | undefined> = {
  OWNER: undefined,
  ADMIN: selectors.addMemberModal.roleOptionAdmin,
  PM: selectors.addMemberModal.roleOptionPm,
  DEVELOPER: selectors.addMemberModal.roleOptionDeveloper,
  STAKEHOLDER: undefined,
  VIEWER: selectors.addMemberModal.roleOptionViewer,
};

/**
 * Page Object Model for workspace settings and membership management.
 */
export class WorkspaceSettingsPage {
  constructor(private page: Page) {}

  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`http://localhost:3000/w/${workspaceSlug}/settings`);
    await this.waitForLoad();
  }

  async waitForLoad(): Promise<void> {
    await expect(this.page.locator(selectors.pageTitle.settings)).toBeVisible({ timeout: 10000 });
  }

  async openAddMemberModal(): Promise<void> {
    await this.page.locator(selectors.workspaceMembers.addButton).click();
    await expect(this.page.locator(selectors.addMemberModal.modal)).toBeVisible({ timeout: 10000 });
  }

  async inviteMember(options: { githubUsername: string; role?: WorkspaceRole }): Promise<void> {
    const { githubUsername, role = WorkspaceRole.DEVELOPER } = options;

    const modal = this.page.locator(selectors.addMemberModal.modal);
    if (!(await modal.isVisible())) {
      await this.openAddMemberModal();
    }

    await modal.locator(selectors.addMemberModal.githubInput).fill(githubUsername);

    const roleSelector = roleSelectors[role];
    if (roleSelector && role !== WorkspaceRole.DEVELOPER) {
      await modal.locator(selectors.addMemberModal.roleTrigger).click();
      await this.page.locator(roleSelector).click();
    }

    await modal.locator(selectors.addMemberModal.submit).click();
    await expect(modal).toBeHidden({ timeout: 10000 });
  }

  async expectMemberVisible(username: string): Promise<void> {
    const memberRow = this.page.locator(dynamicSelectors.workspaceMemberRowByUsername(username));
    await expect(memberRow).toBeVisible({ timeout: 10000 });
  }

  async expectMemberRole(username: string, role: WorkspaceRole): Promise<void> {
    const roleBadge = this.page.locator(dynamicSelectors.workspaceMemberRoleBadgeByUsername(username));
    await expect(roleBadge).toHaveText(role, { timeout: 10000 });
  }

  async changeMemberRole(username: string, role: WorkspaceRole): Promise<void> {
    const action = this.getRoleActionSelector(role);
    if (!action) {
      throw new Error(`Role ${role} is not supported by the UI`);
    }

    const row = this.page.locator(dynamicSelectors.workspaceMemberRowByUsername(username));
    await row.locator(selectors.workspaceMembers.actionsButton).click();
    await this.page.locator(action).click();
    await this.expectMemberRole(username, role);
  }

  async removeMember(username: string): Promise<void> {
    const row = this.page.locator(dynamicSelectors.workspaceMemberRowByUsername(username));
    await row.locator(selectors.workspaceMembers.actionsButton).click();
    await this.page.locator(selectors.workspaceMembers.actionRemove).click();

    const dialog = this.page.locator(selectors.dialogs.confirm);
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await this.page.locator(selectors.dialogs.confirmButton).click();
    await expect(row).toHaveCount(0, { timeout: 10000 });
  }

  async expectMemberAbsent(username: string): Promise<void> {
    const row = this.page.locator(dynamicSelectors.workspaceMemberRowByUsername(username));
    await expect(row).toHaveCount(0, { timeout: 10000 });
  }

  private getRoleActionSelector(role: WorkspaceRole): string | undefined {
    switch (role) {
      case WorkspaceRole.ADMIN:
        return selectors.workspaceMembers.actionMakeAdmin;
      case WorkspaceRole.PM:
        return selectors.workspaceMembers.actionMakePM;
      case WorkspaceRole.DEVELOPER:
        return selectors.workspaceMembers.actionMakeDeveloper;
      case WorkspaceRole.VIEWER:
        return selectors.workspaceMembers.actionMakeViewer;
      default:
        return undefined;
    }
  }
}
