import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RepositoryForm from '@/components/stakgraph/forms/RepositoryForm';
import type { RepositoryData, Repository } from '@/components/stakgraph/types';
import * as useRepositoryPermissionsModule from '@/hooks/useRepositoryPermissions';
import * as useWorkspaceModule from '@/hooks/useWorkspace';

// Mock the hooks
vi.mock('@/hooks/useRepositoryPermissions');
vi.mock('@/hooks/useWorkspace');
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('RepositoryForm - Admin Access Validation', () => {
  const mockCheckPermissions = vi.fn();
  const mockOnChange = vi.fn();
  const mockOnValidationChange = vi.fn();

  const defaultRepositoryData: RepositoryData = {
    repositories: [
      {
        repositoryUrl: 'https://github.com/test/repo',
        branch: 'main',
        name: 'repo',
        codeIngestionEnabled: false,
        docsEnabled: false,
        mocksEnabled: false,
        embeddingsEnabled: false,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock useWorkspace
    vi.mocked(useWorkspaceModule.useWorkspace).mockReturnValue({
      slug: 'test-workspace',
      workspace: null,
      role: null,
      isLoading: false,
      switchWorkspace: vi.fn(),
      refreshWorkspace: vi.fn(),
    });

    // Mock useRepositoryPermissions with default values
    vi.mocked(useRepositoryPermissionsModule.useRepositoryPermissions).mockReturnValue({
      permissions: null,
      loading: false,
      error: null,
      message: null,
      checkPermissions: mockCheckPermissions,
    });
  });

  it('renders amber "Admin Access Required" badge when hasAccess: true but canAdmin: false', async () => {
    // Mock successful check but no admin access
    vi.mocked(useRepositoryPermissionsModule.useRepositoryPermissions).mockReturnValue({
      permissions: {
        hasAccess: true,
        canPush: false,
        canAdmin: false,
        repository: {
          default_branch: 'main',
          name: 'repo',
          full_name: 'test/repo',
        },
      },
      loading: false,
      error: null,
      message: null,
      checkPermissions: mockCheckPermissions,
    });

    render(
      <RepositoryForm
        data={defaultRepositoryData}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Click verify button
    const verifyButton = screen.getByRole('button', { name: /verify/i });
    await userEvent.click(verifyButton);

    // Wait for the permission check to complete
    await waitFor(() => {
      const badge = screen.getByText('Admin Access Required');
      expect(badge).toBeInTheDocument();
    });

    // Verify the amber badge is displayed
    expect(screen.getByText('Admin Access Required')).toBeInTheDocument();
  });

  it('renders green "Access Verified" badge when hasAccess: true and canAdmin: true', async () => {
    // Mock successful check with admin access
    vi.mocked(useRepositoryPermissionsModule.useRepositoryPermissions).mockReturnValue({
      permissions: {
        hasAccess: true,
        canPush: true,
        canAdmin: true,
        repository: {
          default_branch: 'main',
          name: 'repo',
          full_name: 'test/repo',
        },
      },
      loading: false,
      error: null,
      message: null,
      checkPermissions: mockCheckPermissions,
    });

    render(
      <RepositoryForm
        data={defaultRepositoryData}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Click verify button
    const verifyButton = screen.getByRole('button', { name: /verify/i });
    await userEvent.click(verifyButton);

    // Wait for the permission check to complete
    await waitFor(() => {
      const badge = screen.getByText('Access Verified');
      expect(badge).toBeInTheDocument();
    });

    // Verify the green badge is displayed
    expect(screen.getByText('Access Verified')).toBeInTheDocument();
  });

  it('pre-initializes repos with id as verified (canAdmin: true) on mount', async () => {
    const repoWithId: Repository = {
      id: 'existing-repo-id',
      repositoryUrl: 'https://github.com/test/existing-repo',
      branch: 'main',
      name: 'existing-repo',
      codeIngestionEnabled: true,
      docsEnabled: true,
      mocksEnabled: false,
      embeddingsEnabled: true,
    };

    render(
      <RepositoryForm
        data={{ repositories: [repoWithId] }}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Should immediately show "Access Verified" badge without verification
    await waitFor(() => {
      const badge = screen.getByText('Access Verified');
      expect(badge).toBeInTheDocument();
    });

    // Verify button should not have been clicked
    expect(mockCheckPermissions).not.toHaveBeenCalled();
  });

  it('starts repos without id as unverified (canAdmin: null)', async () => {
    const newRepo: Repository = {
      repositoryUrl: 'https://github.com/test/new-repo',
      branch: 'main',
      name: 'new-repo',
      codeIngestionEnabled: false,
      docsEnabled: false,
      mocksEnabled: false,
      embeddingsEnabled: false,
    };

    render(
      <RepositoryForm
        data={{ repositories: [newRepo] }}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Should not show any verification badge initially
    expect(screen.queryByText('Access Verified')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin Access Required')).not.toBeInTheDocument();

    // Should show verify button
    const verifyButton = screen.getByRole('button', { name: /verify/i });
    expect(verifyButton).toBeInTheDocument();
  });

  it('calls onValidationChange with error when repo lacks admin verification', async () => {
    const newRepo: Repository = {
      repositoryUrl: 'https://github.com/test/new-repo',
      branch: 'main',
      name: 'new-repo',
      codeIngestionEnabled: false,
      docsEnabled: false,
      mocksEnabled: false,
      embeddingsEnabled: false,
    };

    render(
      <RepositoryForm
        data={{ repositories: [newRepo] }}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Should have called with error on mount since repo is unverified
    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith({
        'repositories.0.adminVerification': 'Admin access required',
      });
    });
  });

  it('calls onValidationChange with empty object when all repos have canAdmin: true', async () => {
    const verifiedRepo: Repository = {
      id: 'verified-repo-id',
      repositoryUrl: 'https://github.com/test/verified-repo',
      branch: 'main',
      name: 'verified-repo',
      codeIngestionEnabled: true,
      docsEnabled: false,
      mocksEnabled: false,
      embeddingsEnabled: false,
    };

    render(
      <RepositoryForm
        data={{ repositories: [verifiedRepo] }}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // After pre-verification, should call with empty errors
    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith({});
    });
  });

  it('resets canAdmin to null when repository URL changes', async () => {
    const repoWithId: Repository = {
      id: 'existing-repo-id',
      repositoryUrl: 'https://github.com/test/existing-repo',
      branch: 'main',
      name: 'existing-repo',
      codeIngestionEnabled: false,
      docsEnabled: false,
      mocksEnabled: false,
      embeddingsEnabled: false,
    };

    render(
      <RepositoryForm
        data={{ repositories: [repoWithId] }}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Initially should show verified badge
    await waitFor(() => {
      expect(screen.getByText('Access Verified')).toBeInTheDocument();
    });

    // Initially should call with empty errors
    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith({});
    });

    // Change the URL
    const urlInput = screen.getByPlaceholderText('https://github.com/username/repository');
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://github.com/test/different-repo');

    // Should no longer show verified badge
    await waitFor(() => {
      expect(screen.queryByText('Access Verified')).not.toBeInTheDocument();
    });

    // Should call onValidationChange with error after URL change
    await waitFor(() => {
      const calls = mockOnValidationChange.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toEqual({
        'repositories.0.adminVerification': 'Admin access required',
      });
    });
  });

  it('handles multiple repositories with mixed verification states', async () => {
    const repos: Repository[] = [
      {
        id: 'verified-repo',
        repositoryUrl: 'https://github.com/test/verified',
        branch: 'main',
        name: 'verified',
        codeIngestionEnabled: true,
        docsEnabled: false,
        mocksEnabled: false,
        embeddingsEnabled: false,
      },
      {
        repositoryUrl: 'https://github.com/test/unverified',
        branch: 'main',
        name: 'unverified',
        codeIngestionEnabled: false,
        docsEnabled: false,
        mocksEnabled: false,
        embeddingsEnabled: false,
      },
    ];

    render(
      <RepositoryForm
        data={{ repositories: repos }}
        errors={{}}
        loading={false}
        onChange={mockOnChange}
        onValidationChange={mockOnValidationChange}
      />
    );

    // Should show verified badge for first repo
    await waitFor(() => {
      const badges = screen.getAllByText('Access Verified');
      expect(badges).toHaveLength(1);
    });

    // Should call onValidationChange with error for second repo only
    await waitFor(() => {
      expect(mockOnValidationChange).toHaveBeenCalledWith({
        'repositories.1.adminVerification': 'Admin access required',
      });
    });
  });
});
