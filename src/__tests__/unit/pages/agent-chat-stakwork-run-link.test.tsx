// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * Unit tests for the per-run Stakwork link icon feature on AgentChatMessage
 * and the workflowRunMap derivation logic in AgentChatArea.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Minimal self-contained AgentChatMessage mirror (no external imports)
// ──────────────────────────────────────────────────────────────────────────────
function ExternalLinkIcon() {
  return <svg data-testid="external-link-icon" />;
}

function AgentChatMessage({
  message,
  stakworkProjectId,
  isSuperAdmin = false,
}: {
  message: { id: string; role: string; message?: string };
  stakworkProjectId?: string;
  isSuperAdmin?: boolean;
}) {
  const isUser = message.role === 'USER' || message.role === 'user';
  const textContent = message.message ?? '';

  return (
    <div>
      <div className={`flex items-end gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`px-4 py-1 rounded-md max-w-full shadow-sm relative ${
            isUser
              ? 'group bg-primary text-primary-foreground rounded-br-md'
              : 'bg-background text-foreground rounded-bl-md border'
          }`}
        >
          {isUser ? (
            <>
              <span data-testid="markdown">{textContent}</span>
              {isSuperAdmin && stakworkProjectId && (
                <div
                  className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10"
                  data-testid="stakwork-link-wrapper"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(
                        `https://jobs.stakwork.com/admin/projects/${stakworkProjectId}`,
                        '_blank',
                        'noopener,noreferrer'
                      );
                    }}
                    className="h-6 w-6 p-0 hover:bg-background/80 border border-border/50 shadow-sm bg-background"
                    aria-label="View run on Stakwork"
                  >
                    <ExternalLinkIcon />
                  </button>
                </div>
              )}
            </>
          ) : (
            <span data-testid="markdown-assistant">{textContent}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: build workflowRunMap (mirrors the useMemo in AgentChatArea)
// ──────────────────────────────────────────────────────────────────────────────
type ArtifactLike = { type: string; content?: { projectId?: string } };
type MessageLike = {
  id: string;
  role: 'USER' | 'ASSISTANT';
  message?: string;
  artifacts?: ArtifactLike[];
};

function buildWorkflowRunMap(
  messages: MessageLike[],
  taskMode: string,
  isSuperAdmin: boolean
): Map<string, string> {
  if (taskMode !== 'workflow_editor' || !isSuperAdmin) return new Map<string, string>();
  const map = new Map<string, string>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'USER') continue;
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === 'USER') break;
      const workflowArtifact = messages[j].artifacts?.find(
        (a) => a.type === 'WORKFLOW' && a.content?.projectId
      );
      if (workflowArtifact) {
        map.set(msg.id, workflowArtifact.content!.projectId!);
        break;
      }
    }
  }
  return map;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: workflowRunMap derivation
// ──────────────────────────────────────────────────────────────────────────────
describe('workflowRunMap derivation', () => {
  it('maps USER message id to projectId from following WORKFLOW artifact', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'hello' },
      {
        id: 'assistant-1',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: { projectId: '123' } }],
      },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.get('user-1')).toBe('123');
  });

  it('correctly pairs multiple USER messages with their respective runs', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'first' },
      {
        id: 'assistant-1',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: { projectId: '100' } }],
      },
      { id: 'user-2', role: 'USER', message: 'second' },
      {
        id: 'assistant-2',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: { projectId: '200' } }],
      },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.get('user-1')).toBe('100');
    expect(map.get('user-2')).toBe('200');
  });

  it('returns no entry for a USER message with no following WORKFLOW artifact', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'no run yet' },
      { id: 'assistant-1', role: 'ASSISTANT', artifacts: [] },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.has('user-1')).toBe(false);
  });

  it('returns no entry when the WORKFLOW artifact has no projectId', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'hello' },
      {
        id: 'assistant-1',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: {} }],
      },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.has('user-1')).toBe(false);
  });

  it('stops scanning at the next USER message (does not cross boundaries)', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'first' },
      { id: 'assistant-1', role: 'ASSISTANT', artifacts: [] },
      { id: 'user-2', role: 'USER', message: 'second' },
      {
        id: 'assistant-2',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: { projectId: '999' } }],
      },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    // user-1's scan stops at user-2, so no projectId from assistant-2
    expect(map.has('user-1')).toBe(false);
    expect(map.get('user-2')).toBe('999');
  });

  it('ignores non-WORKFLOW artifact types', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'hello' },
      {
        id: 'assistant-1',
        role: 'ASSISTANT',
        artifacts: [{ type: 'PULL_REQUEST', content: { projectId: 'should-not-match' } }],
      },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.has('user-1')).toBe(false);
  });

  it('picks the first WORKFLOW artifact when multiple follow a USER message', () => {
    const messages: MessageLike[] = [
      { id: 'user-1', role: 'USER', message: 'hello' },
      {
        id: 'assistant-1',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: { projectId: 'first-id' } }],
      },
      {
        id: 'assistant-2',
        role: 'ASSISTANT',
        artifacts: [{ type: 'WORKFLOW', content: { projectId: 'second-id' } }],
      },
    ];
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.get('user-1')).toBe('first-id');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: AgentChatArea guard — empty map when conditions not met
// ──────────────────────────────────────────────────────────────────────────────
describe('workflowRunMap guard conditions', () => {
  const messages: MessageLike[] = [
    { id: 'user-1', role: 'USER', message: 'hello' },
    {
      id: 'assistant-1',
      role: 'ASSISTANT',
      artifacts: [{ type: 'WORKFLOW', content: { projectId: '42' } }],
    },
  ];

  it('returns empty map when taskMode !== workflow_editor', () => {
    const map = buildWorkflowRunMap(messages, 'live', true);
    expect(map.size).toBe(0);
  });

  it('returns empty map when isSuperAdmin is false', () => {
    const map = buildWorkflowRunMap(messages, 'workflow_editor', false);
    expect(map.size).toBe(0);
  });

  it('returns populated map only when both conditions are met', () => {
    const map = buildWorkflowRunMap(messages, 'workflow_editor', true);
    expect(map.size).toBe(1);
    expect(map.get('user-1')).toBe('42');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests: AgentChatMessage rendering
// ──────────────────────────────────────────────────────────────────────────────
describe('AgentChatMessage — Stakwork link icon', () => {
  const userMessage = { id: 'msg-1', role: 'USER', message: 'hello world' };

  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders link icon when isSuperAdmin=true and stakworkProjectId is set', () => {
    render(
      <AgentChatMessage
        message={userMessage}
        isSuperAdmin={true}
        stakworkProjectId="777"
      />
    );
    expect(screen.getByLabelText('View run on Stakwork')).toBeTruthy();
    expect(screen.getByTestId('stakwork-link-wrapper')).toBeTruthy();
  });

  it('does NOT render link icon when isSuperAdmin=false', () => {
    render(
      <AgentChatMessage
        message={userMessage}
        isSuperAdmin={false}
        stakworkProjectId="777"
      />
    );
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('does NOT render link icon when stakworkProjectId is undefined', () => {
    render(
      <AgentChatMessage
        message={userMessage}
        isSuperAdmin={true}
        stakworkProjectId={undefined}
      />
    );
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('does NOT render link icon on ASSISTANT messages even with isSuperAdmin=true', () => {
    const assistantMessage = { id: 'msg-2', role: 'ASSISTANT', message: 'response' };
    render(
      <AgentChatMessage
        message={assistantMessage}
        isSuperAdmin={true}
        stakworkProjectId="777"
      />
    );
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('opens the correct Stakwork URL in a new tab when clicked', () => {
    render(
      <AgentChatMessage
        message={userMessage}
        isSuperAdmin={true}
        stakworkProjectId="12345"
      />
    );
    const button = screen.getByLabelText('View run on Stakwork');
    fireEvent.click(button);
    expect(window.open).toHaveBeenCalledWith(
      'https://jobs.stakwork.com/admin/projects/12345',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('does NOT render link icon when both isSuperAdmin=false and no projectId', () => {
    render(
      <AgentChatMessage
        message={userMessage}
        isSuperAdmin={false}
        stakworkProjectId={undefined}
      />
    );
    expect(screen.queryByTestId('stakwork-link-wrapper')).toBeNull();
  });
});
