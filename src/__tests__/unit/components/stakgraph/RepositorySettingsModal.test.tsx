// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RepositorySettingsModal } from '@/components/stakgraph/forms/RepositorySettingsModal';
import type { Repository } from '@/components/stakgraph/types';

// Minimal mocks for Radix UI dialog portals
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    id,
    onCheckedChange,
    disabled,
  }: {
    checked: boolean;
    id: string;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      id={id}
      data-testid={id}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: ({
    id,
    value,
    onChange,
    placeholder,
    disabled,
    className,
    'aria-describedby': ariaDescribedBy,
  }: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      id={id}
      data-testid={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      aria-describedby={ariaDescribedBy}
    />
  ),
}));

const baseRepository: Repository = {
  id: 'repo-1',
  repositoryUrl: 'https://github.com/test/repo',
  branch: 'main',
  name: 'repo',
  codeIngestionEnabled: true,
  docsEnabled: true,
  mocksEnabled: false,
  embeddingsEnabled: true,
  triggerPodRepair: false,
  shallowClone: false,
  blobSizeLimit: null,
};

describe('RepositorySettingsModal - triggerPodRepair initialisation', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialises triggerPodRepair as false when repository.triggerPodRepair is false', () => {
    const repo = { ...baseRepository, triggerPodRepair: false };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('trigger-pod-repair') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('initialises triggerPodRepair as true when repository.triggerPodRepair is true', () => {
    const repo = { ...baseRepository, triggerPodRepair: true };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('trigger-pod-repair') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('falls back to false when repository.triggerPodRepair is undefined', () => {
    const repo = { ...baseRepository, triggerPodRepair: undefined };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('trigger-pod-repair') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });
});

describe('RepositorySettingsModal - shallowClone initialisation', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialises shallowClone as false by default', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('shallow-clone') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('initialises shallowClone as true when repository.shallowClone is true', () => {
    const repo = { ...baseRepository, shallowClone: true };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('shallow-clone') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('falls back to false when repository.shallowClone is undefined', () => {
    const repo = { ...baseRepository, shallowClone: undefined };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('shallow-clone') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('toggling shallowClone updates the switch state', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const toggle = screen.getByTestId('shallow-clone') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(false);
  });
});

describe('RepositorySettingsModal - blobSizeLimit initialisation', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialises blobSizeLimit as empty string by default (null repo value)', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('initialises blobSizeLimit from repository prop', () => {
    const repo = { ...baseRepository, blobSizeLimit: '1m' };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
    expect(input.value).toBe('1m');
  });

  it('falls back to empty string when repository.blobSizeLimit is undefined', () => {
    const repo = { ...baseRepository, blobSizeLimit: undefined };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
    expect(input.value).toBe('');
  });
});

describe('RepositorySettingsModal - blobSizeLimit validation', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validValues = ['1m', '500k', '2g', '100', '1K', '1M', '1G'];
  const invalidValues = ['abc', '0', '0m', 'abc123', '1mb', '1 m', '-1m', ''];

  validValues.forEach((value) => {
    it(`does NOT show validation error for valid value "${value}"`, () => {
      render(
        <RepositorySettingsModal
          open
          onOpenChange={mockOnOpenChange}
          repository={baseRepository}
          isNewRepository={false}
          onSave={mockOnSave}
        />
      );

      const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
      fireEvent.change(input, { target: { value } });

      expect(screen.queryByText(/Invalid size format/i)).toBeNull();
    });
  });

  // Empty string is valid (means "no limit")
  it('does NOT show validation error for empty string', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    expect(screen.queryByText(/Invalid size format/i)).toBeNull();
  });

  ['abc', '0', '0m', 'abc123', '1mb', '-1m'].forEach((value) => {
    it(`shows validation error for invalid value "${value}"`, () => {
      render(
        <RepositorySettingsModal
          open
          onOpenChange={mockOnOpenChange}
          repository={baseRepository}
          isNewRepository={false}
          onSave={mockOnSave}
        />
      );

      const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
      fireEvent.change(input, { target: { value } });

      expect(screen.getByText(/Invalid size format/i)).toBeTruthy();
    });
  });
});

describe('RepositorySettingsModal - Save button disabled on invalid input', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Save button is enabled when blobSizeLimit is empty (valid)', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('Save button is enabled when blobSizeLimit is a valid value like "1m"', () => {
    const repo = { ...baseRepository, blobSizeLimit: '1m' };
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('Save button is disabled when blobSizeLimit is invalid', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    expect(saveButton).toBeDisabled();
  });

  it('Save button becomes re-enabled after correcting invalid input', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByRole('button', { name: /save settings/i })).toBeDisabled();

    fireEvent.change(input, { target: { value: '1m' } });
    expect(screen.getByRole('button', { name: /save settings/i })).not.toBeDisabled();
  });

  it('does not call onSave when Save is clicked with invalid input', async () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const input = screen.getByTestId('blob-size-limit') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    fireEvent.click(saveButton);

    expect(mockOnSave).not.toHaveBeenCalled();
  });
});

describe('RepositorySettingsModal - reset on repository change', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets shallowClone and blobSizeLimit when repository prop changes', () => {
    const repoA: Repository = { ...baseRepository, shallowClone: false, blobSizeLimit: null };
    const repoB: Repository = { ...baseRepository, id: 'repo-2', shallowClone: true, blobSizeLimit: '500k' };

    const { rerender } = render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repoA}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const shallowToggle = screen.getByTestId('shallow-clone') as HTMLInputElement;
    const sizeInput = screen.getByTestId('blob-size-limit') as HTMLInputElement;

    expect(shallowToggle.checked).toBe(false);
    expect(sizeInput.value).toBe('');

    rerender(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repoB}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    expect(shallowToggle.checked).toBe(true);
    expect(sizeInput.value).toBe('500k');
  });

  it('resets to defaults when switching to a repo without shallowClone/blobSizeLimit', () => {
    const repoA: Repository = { ...baseRepository, shallowClone: true, blobSizeLimit: '1m' };
    const repoB: Repository = { ...baseRepository, id: 'repo-2', shallowClone: undefined, blobSizeLimit: undefined };

    const { rerender } = render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repoA}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    rerender(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repoB}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const shallowToggle = screen.getByTestId('shallow-clone') as HTMLInputElement;
    const sizeInput = screen.getByTestId('blob-size-limit') as HTMLInputElement;

    expect(shallowToggle.checked).toBe(false);
    expect(sizeInput.value).toBe('');
  });
});

describe('RepositorySettingsModal - onSave payload includes new fields', () => {
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onSave with shallowClone and blobSizeLimit in payload', async () => {
    const mockOnSave = vi.fn().mockResolvedValue(undefined);
    const repo = { ...baseRepository, shallowClone: true, blobSizeLimit: '1m' };

    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        shallowClone: true,
        blobSizeLimit: '1m',
      })
    );
  });

  it('calls onSave with empty blobSizeLimit when cleared', async () => {
    const mockOnSave = vi.fn().mockResolvedValue(undefined);
    const repo = { ...baseRepository, shallowClone: false, blobSizeLimit: null };

    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={repo}
        isNewRepository={false}
        onSave={mockOnSave}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save settings/i });
    await act(async () => {
      fireEvent.click(saveButton);
    });

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        shallowClone: false,
        blobSizeLimit: '',
      })
    );
  });
});

describe('RepositorySettingsModal - new repository flow', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Continue" button for new repositories', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository
        onSave={mockOnSave}
      />
    );

    expect(screen.getByRole('button', { name: /continue/i })).toBeTruthy();
  });

  it('shallow clone and size limit are still present and functional for new repos', () => {
    render(
      <RepositorySettingsModal
        open
        onOpenChange={mockOnOpenChange}
        repository={baseRepository}
        isNewRepository
        onSave={mockOnSave}
      />
    );

    expect(screen.getByTestId('shallow-clone')).toBeTruthy();
    expect(screen.getByTestId('blob-size-limit')).toBeTruthy();
  });
});
