import { describe, it, expect } from 'vitest';
import { ChatMessage, ChatRole, ChatStatus, ArtifactType } from '@/lib/chat';
import { isClarifyingQuestions } from '@/types/stakwork';

/**
 * Tests for hasUnansweredClarifyingQuestion logic
 * This logic is implemented in PlanChatView.tsx to detect when a clarifying question
 * artifact is present and hasn't been answered yet.
 */
describe('hasUnansweredClarifyingQuestion logic', () => {
  /**
   * Helper function that mimics the logic in PlanChatView.tsx
   */
  const hasUnansweredClarifyingQuestion = (messages: ChatMessage[]): boolean => {
    // Find the last ASSISTANT message with a PLAN-type clarifying question artifact
    let lastClarifyingMessage: ChatMessage | null = null;
    
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === ChatRole.ASSISTANT) {
        const hasClarifyingArtifact = msg.artifacts?.some(
          artifact => artifact.type === ArtifactType.PLAN && isClarifyingQuestions(artifact.content)
        );
        if (hasClarifyingArtifact) {
          lastClarifyingMessage = msg;
          break;
        }
      }
    }

    if (!lastClarifyingMessage) {
      return false;
    }

    // Check if any message has replyId matching the clarifying message
    const hasReply = messages.some(msg => msg.replyId === lastClarifyingMessage!.id);
    
    return !hasReply;
  };

  it('returns true when the last ASSISTANT message has a PLAN-type clarifying artifact with no reply', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        taskId: null,
        message: 'I want to build a login feature',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'msg-2',
        taskId: null,
        message: 'I have some questions',
        workflowUrl: null,
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: 'artifact-1',
            messageId: 'msg-2',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              tool_use: 'ask_clarifying_questions',
              content: [
                { question: 'What authentication method?', type: 'TEXT' as const },
                { question: 'Do you need OAuth?', type: 'TEXT' as const },
              ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ];

    expect(hasUnansweredClarifyingQuestion(messages)).toBe(true);
  });

  it('returns false when a message with a matching replyId exists', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        taskId: null,
        message: 'I want to build a login feature',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'msg-2',
        taskId: null,
        message: 'I have some questions',
        workflowUrl: null,
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: 'artifact-1',
            messageId: 'msg-2',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              tool_use: 'ask_clarifying_questions',
              questions: [
                { question: 'What authentication method?' },
              ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      {
        id: 'msg-3',
        taskId: null,
        message: 'Email and password',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: 'msg-2',
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    expect(hasUnansweredClarifyingQuestion(messages)).toBe(false);
  });

  it('returns false when no ASSISTANT message has a clarifying artifact', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        taskId: null,
        message: 'I want to build a login feature',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'msg-2',
        taskId: null,
        message: 'Great! Let me help you with that.',
        workflowUrl: null,
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: 'artifact-1',
            messageId: 'msg-2',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              brief: 'Login feature',
              requirements: ['Authentication'],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ];

    expect(hasUnansweredClarifyingQuestion(messages)).toBe(false);
  });

  it('returns false when the messages array is empty', () => {
    const messages: ChatMessage[] = [];
    expect(hasUnansweredClarifyingQuestion(messages)).toBe(false);
  });

  it('returns true only for the LAST clarifying question, ignoring earlier answered ones', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        taskId: null,
        message: 'I want to build a login feature',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'msg-2',
        taskId: null,
        message: 'First questions',
        workflowUrl: null,
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: 'artifact-1',
            messageId: 'msg-2',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              tool_use: 'ask_clarifying_questions',
              questions: [
                { question: 'What authentication method?' },
              ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      {
        id: 'msg-3',
        taskId: null,
        message: 'Email and password',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: 'msg-2',
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'msg-4',
        taskId: null,
        message: 'More questions',
        workflowUrl: null,
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: 'artifact-2',
            messageId: 'msg-4',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              tool_use: 'ask_clarifying_questions',
              content: [
                { question: 'Do you need 2FA?', type: 'TEXT' as const },
              ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ];

    // The last clarifying question (msg-4) has no reply, so should return true
    expect(hasUnansweredClarifyingQuestion(messages)).toBe(true);
  });

  it('handles messages with multiple artifacts correctly', () => {
    const messages: ChatMessage[] = [
      {
        id: 'msg-1',
        taskId: null,
        message: 'I want to build a login feature',
        workflowUrl: null,
        role: ChatRole.USER,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'msg-2',
        taskId: null,
        message: 'Here are some questions',
        workflowUrl: null,
        role: ChatRole.ASSISTANT,
        timestamp: new Date(),
        contextTags: [],
        status: ChatStatus.SENT,
        sourceWebsocketID: null,
        replyId: null,
        userId: null,
        featureId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        artifacts: [
          {
            id: 'artifact-1',
            messageId: 'msg-2',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              brief: 'Login feature',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'artifact-2',
            messageId: 'msg-2',
            type: ArtifactType.PLAN,
            icon: null,
            content: {
              tool_use: 'ask_clarifying_questions',
              content: [
                { question: 'What authentication method?', type: 'TEXT' as const },
              ],
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ];

    expect(hasUnansweredClarifyingQuestion(messages)).toBe(true);
  });
});
