import type { LearnMessage } from '@/types/learn';

export const TestDataFactories = {
  userMessage: (overrides: Partial<LearnMessage> = {}): LearnMessage => ({
    id: 'msg-user-1',
    role: 'user',
    content: 'Test user message',
    timestamp: new Date('2024-01-15T12:00:00Z'),
    ...overrides,
  }),

  assistantMessage: (overrides: Partial<LearnMessage> = {}): LearnMessage => ({
    id: 'msg-assistant-1',
    role: 'assistant',
    content: 'Test assistant response',
    timestamp: new Date('2024-01-15T12:01:00Z'),
    ...overrides,
  }),

  messageWithMarkdown: (markdown: string): LearnMessage => ({
    id: 'msg-markdown',
    role: 'assistant',
    content: markdown,
    timestamp: new Date('2024-01-15T12:00:00Z'),
  }),

  conversationMessages: (): LearnMessage[] => [
    TestDataFactories.userMessage({ content: 'Hello' }),
    TestDataFactories.assistantMessage({ content: 'Hi there!' }),
    TestDataFactories.userMessage({ id: 'msg-2', content: 'How are you?' }),
    TestDataFactories.assistantMessage({ id: 'msg-3', content: 'I am doing well!' }),
  ],

  emptyMessages: (): LearnMessage[] => [],

  singleMessage: (): LearnMessage[] => [
    TestDataFactories.userMessage({ content: 'Single message' }),
  ],
};
