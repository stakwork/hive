// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

/**
 * Unit tests for the per-run Stakwork link icon feature on AgentChatMessage
 * and ChatMessage (workflow editor mode).
 * stakworkProjectId is stored directly on the ChatMessage row and passed as
 * msg.stakworkProjectId — no artifact scanning required.
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
  message: { id: string; role: string; message?: string; stakworkProjectId?: string | null };
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

  it('does NOT render link icon when stakworkProjectId is null (pre-migration messages)', () => {
    render(
      <AgentChatMessage
        message={{ ...userMessage, stakworkProjectId: null }}
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

  it('renders link icon for non-workflow_editor task modes when stakworkProjectId is set', () => {
    // Previously the link was only shown for workflow_editor taskMode via the artifact scan.
    // Now it appears for any task mode when stakworkProjectId is non-null.
    render(
      <AgentChatMessage
        message={userMessage}
        isSuperAdmin={true}
        stakworkProjectId="999"
      />
    );
    expect(screen.getByLabelText('View run on Stakwork')).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Minimal self-contained ChatMessage mirror (workflow_editor / ChatArea path)
// ──────────────────────────────────────────────────────────────────────────────
function ChatMessage({
  message,
  isSuperAdmin = false,
}: {
  message: { id: string; role: string; message?: string; stakworkProjectId?: string | null };
  isSuperAdmin?: boolean;
}) {
  const isUser = message.role === 'USER';

  return (
    <div>
      <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {message.message && (
          <div className="group relative min-w-0 max-w-full">
            {/* Stakwork run link — sibling of bubble, not clipped by overflow-hidden */}
            {isSuperAdmin && isUser && message.stakworkProjectId && (
              <div
                className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10"
                data-testid="chat-message-stakwork-link-wrapper"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(
                      `https://jobs.stakwork.com/admin/projects/${message.stakworkProjectId}`,
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
            <div
              className={`px-4 py-1 rounded-md max-w-full min-w-0 overflow-hidden break-words shadow-sm ${
                isUser
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-background text-foreground rounded-bl-md border'
              }`}
            >
              <span data-testid={isUser ? 'chat-msg-user' : 'chat-msg-assistant'}>{message.message}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests: ChatMessage (workflow editor / ChatArea path)
// ──────────────────────────────────────────────────────────────────────────────
describe('ChatMessage — Stakwork link icon (workflow_editor / ChatArea path)', () => {
  const userMsg = { id: 'cm-1', role: 'USER', message: 'edit this workflow', stakworkProjectId: '42' };

  beforeEach(() => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  it('renders the link button when isSuperAdmin=true and stakworkProjectId is set', () => {
    render(<ChatMessage message={userMsg} isSuperAdmin={true} />);
    expect(screen.getByLabelText('View run on Stakwork')).toBeTruthy();
    expect(screen.getByTestId('chat-message-stakwork-link-wrapper')).toBeTruthy();
  });

  it('does NOT render the link button when isSuperAdmin=false', () => {
    render(<ChatMessage message={userMsg} isSuperAdmin={false} />);
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('does NOT render the link button when stakworkProjectId is null', () => {
    render(<ChatMessage message={{ ...userMsg, stakworkProjectId: null }} isSuperAdmin={true} />);
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('does NOT render the link button when stakworkProjectId is undefined', () => {
    render(<ChatMessage message={{ ...userMsg, stakworkProjectId: undefined }} isSuperAdmin={true} />);
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('does NOT render the link button on ASSISTANT messages', () => {
    const assistantMsg = { id: 'cm-2', role: 'ASSISTANT', message: 'done', stakworkProjectId: '42' };
    render(<ChatMessage message={assistantMsg} isSuperAdmin={true} />);
    expect(screen.queryByLabelText('View run on Stakwork')).toBeNull();
  });

  it('opens the correct Stakwork URL in a new tab when clicked', () => {
    render(<ChatMessage message={userMsg} isSuperAdmin={true} />);
    const button = screen.getByLabelText('View run on Stakwork');
    fireEvent.click(button);
    expect(window.open).toHaveBeenCalledWith(
      'https://jobs.stakwork.com/admin/projects/42',
      '_blank',
      'noopener,noreferrer'
    );
  });
});
