// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
  Switch: ({ checked, id }: { checked: boolean; id: string }) => (
    <input type="checkbox" id={id} data-testid={id} checked={checked} readOnly />
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
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
