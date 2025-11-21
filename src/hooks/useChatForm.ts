import { useMemo } from "react";
import { ChatMessage, FormContent } from "@/lib/chat";

export function useChatForm(messages: ChatMessage[]) {
  return useMemo(() => {
    if (messages.length === 0) {
      return { hasActiveChatForm: false, webhook: undefined };
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.artifacts) {
        for (const artifact of message.artifacts) {
          if (artifact.type === "FORM" && artifact.content) {
            const formContent = artifact.content as FormContent;
            const hasChatOptions = formContent.options.some((option) => option.actionType === "chat");
            if (hasChatOptions) {
              return {
                hasActiveChatForm: true,
                webhook: formContent.webhook,
              };
            }
          }
        }
        break; // Only check the last message with artifacts
      }
    }

    return { hasActiveChatForm: false, webhook: undefined };
  }, [messages]);
}
