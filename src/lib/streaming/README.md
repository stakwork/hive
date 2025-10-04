# Streaming System

Generic, reusable streaming system for AI SDK integrations with tool calling support.

## Features

- **Type-safe**: Full TypeScript support with generics
- **Tool processors**: Extensible strategy pattern for tool-specific logic
- **Debouncing**: Built-in debouncing to reduce render thrashing
- **Error handling**: Error boundaries and graceful fallbacks
- **Composable UI**: Reusable components with customization options

## Quick Start

### 1. Define your message type

Extend `BaseStreamingMessage` with your domain-specific fields:

```typescript
import type { BaseStreamingMessage } from "@/types/streaming";

export interface MyMessage extends BaseStreamingMessage {
  role: "user" | "assistant";
  timestamp: Date;
  // Add any other fields you need
}
```

### 2. Configure tool processors (optional)

Define custom logic for processing tool outputs:

```typescript
import type { ToolProcessorMap } from "@/types/streaming";
import { cleanXMLTags } from "@/lib/streaming/helpers";

export const myToolProcessors: ToolProcessorMap = {
  web_search: (output) => {
    // Process web search results
    return output;
  },

  final_answer: (output, context) => {
    // Process final answer with access to other tool results via context
    let answer = typeof output === "string" ? output : JSON.stringify(output);
    answer = cleanXMLTags(answer);
    return answer;
  },
};
```

### 3. Use the streaming hook

```typescript
import { useStreamProcessor } from "@/lib/streaming";

function MyComponent() {
  const { processStream } = useStreamProcessor<MyMessage>({
    debounceMs: 50, // Optional, defaults to 50ms
    toolProcessors: myToolProcessors, // Optional
  });

  const handleSend = async (content: string) => {
    const response = await fetch("/api/my-endpoint");

    await processStream(
      response,
      messageId,
      (updatedMessage) => {
        // Update your state with the streaming message
        setMessages(prev => [...prev, updatedMessage]);
      },
      // Optional: additional fields for your message type
      {
        role: "assistant",
        timestamp: new Date(),
      }
    );
  };
}
```

### 4. Render with UI components

```typescript
import {
  StreamingMessage,
  StreamErrorBoundary,
} from "@/components/streaming";

function MessageDisplay({ message }: { message: MyMessage }) {
  return (
    <StreamErrorBoundary>
      <StreamingMessage message={message} />
    </StreamErrorBoundary>
  );
}
```

## Advanced Usage

### Custom rendering

```typescript
<StreamingMessage
  message={message}
  filterTextParts={(id) => id !== "final-answer"}
  renderTextPart={(part) => <CustomTextPart part={part} />}
  textPartClassName="my-custom-class"
  reasoningPartClassName="my-reasoning-class"
/>
```

### Tool processor context

Tool processors can share data via the `context` parameter:

```typescript
export const toolProcessors: ToolProcessorMap = {
  web_search: (output, context) => {
    const results = processResults(output);
    // Store for other processors to use
    context.webSearchResults = results;
    return results;
  },

  final_answer: (output, context) => {
    // Access web search results from context
    const webSearchResults = context.webSearchResults;
    return processAnswer(output, webSearchResults);
  },
};
```

## Components

### `<StreamingMessage />`
Main container for streaming content

### `<StreamTextPart />`
Renders text with markdown support

### `<StreamReasoningPart />`
Renders reasoning/thinking content

### `<StreamToolCall />`
Renders tool call with expandable input/output

### `<StreamErrorBoundary />`
Error boundary for graceful error handling

## Helper Functions

- `cleanXMLTags(text)` - Remove XML artifacts from AI responses
- `extractAnswer(output)` - Extract answer from tool output
- `parseSSELine(line)` - Parse Server-Sent Events data

## Example: Different AI SDK Integration

```typescript
// 1. Define your types
export interface TaskMessage extends BaseStreamingMessage {
  taskId: string;
  status: "pending" | "processing" | "complete";
}

// 2. Configure tool processors
export const taskToolProcessors: ToolProcessorMap = {
  code_analysis: (output) => {
    return analyzeCode(output);
  },
};

// 3. Use in component
const { processStream } = useStreamProcessor<TaskMessage>({
  toolProcessors: taskToolProcessors,
});

await processStream(response, messageId, onUpdate, {
  taskId: "task-123",
  status: "processing",
});

// 4. Render
<StreamingMessage message={taskMessage} />
```

## Learn Feature Example

See `/src/app/w/[slug]/learn/` for a complete working example.
