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

  // Workspace Details Editing Methods

  async expectWorkspaceDetailsVisible(): Promise<void> {
    await expect(this.page.locator(selectors.workspaceDetails.card)).toBeVisible({ timeout: 10000 });
  }

  async getWorkspaceName(): Promise<string> {
    const input = this.page.locator(selectors.workspaceDetails.nameInput);
    return (await input.inputValue()) || '';
  }

  async getWorkspaceSlug(): Promise<string> {
    const input = this.page.locator(selectors.workspaceDetails.slugInput);
    return (await input.inputValue()) || '';
  }

  async getWorkspaceDescription(): Promise<string> {
    const input = this.page.locator(selectors.workspaceDetails.descriptionInput);
    return (await input.inputValue()) || '';
  }

  async updateWorkspaceName(name: string): Promise<void> {
    const input = this.page.locator(selectors.workspaceDetails.nameInput);
    await input.clear();
    await input.fill(name);
  }

  async updateWorkspaceSlug(slug: string): Promise<void> {
    const input = this.page.locator(selectors.workspaceDetails.slugInput);
    await input.clear();
    await input.fill(slug);
  }

  async updateWorkspaceDescription(description: string): Promise<void> {
    const input = this.page.locator(selectors.workspaceDetails.descriptionInput);
    await input.clear();
    await input.fill(description);
  }

  async submitWorkspaceUpdate(): Promise<void> {
    const button = this.page.locator(selectors.workspaceDetails.updateButton);
    await expect(button).toBeEnabled({ timeout: 5000 });
    await button.click();
  }

  async expectUpdateButtonDisabled(): Promise<void> {
    const button = this.page.locator(selectors.workspaceDetails.updateButton);
    await expect(button).toBeDisabled({ timeout: 5000 });
  }

  async expectUpdateButtonEnabled(): Promise<void> {
    const button = this.page.locator(selectors.workspaceDetails.updateButton);
    await expect(button).toBeEnabled({ timeout: 5000 });
  }

  async updateWorkspaceDetails(options: {
    name?: string;
    slug?: string;
    description?: string;
  }): Promise<void> {
    if (options.name !== undefined) {
      await this.updateWorkspaceName(options.name);
    }
    if (options.slug !== undefined) {
      await this.updateWorkspaceSlug(options.slug);
    }
    if (options.description !== undefined) {
      await this.updateWorkspaceDescription(options.description);
    }
    await this.submitWorkspaceUpdate();
  }

  async expectWorkspaceDetails(options: {
    name?: string;
    slug?: string;
    description?: string;
  }): Promise<void> {
    if (options.name !== undefined) {
      expect(await this.getWorkspaceName()).toBe(options.name);
    }
    if (options.slug !== undefined) {
      expect(await this.getWorkspaceSlug()).toBe(options.slug);
    }
    if (options.description !== undefined) {
      expect(await this.getWorkspaceDescription()).toBe(options.description);
    }
  }

  async expectSuccessToast(): Promise<void> {
    const toast = this.page.locator('text="Workspace updated successfully"');
    await expect(toast).toBeVisible({ timeout: 10000 });
  }

  async expectErrorToast(message?: string): Promise<void> {
    if (message) {
      const toast = this.page.locator(`text="${message}"`);
      await expect(toast).toBeVisible({ timeout: 10000 });
    } else {
      const toast = this.page.locator('[role="alert"], [role="status"]').filter({ hasText: /error|failed/i });
      await expect(toast.first()).toBeVisible({ timeout: 10000 });
    }
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
