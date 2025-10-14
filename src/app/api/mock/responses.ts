import {
  makeRes,
  createArtifact,
  ArtifactType,
  PYTHON_CODE,
  JSON_CODE,
  REPOMAP,
  MARKDOWN_EXAMPLE,
} from "./helpers";

// Generate unique IDs to prevent collisions
function generateUniqueId() {
  return `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function generateCodeResponse() {
  const messageId = generateUniqueId();

  return makeRes(
    "Perfect! I've created the connection leak monitor implementation. Here's what I've built:",
    [
      createArtifact({
        id: "code-artifact-1",
        messageId: messageId,
        type: ArtifactType.CODE,
        content: {
          file: "stakwork/senza-lnd/lib/connection_leak_monitor.rb",
          content: PYTHON_CODE,
          change: "Create main connection leak monitor class",
          action: "create",
        },
      }),
      createArtifact({
        id: "code-artifact-2",
        messageId: messageId,
        type: ArtifactType.CODE,
        content: {
          file: "stakwork/senza-lnd/config/database.json",
          content: JSON_CODE,
          change:
            "Add Aurora Postgres database configuration with connection leak monitoring settings",
          action: "create",
        },
      }),
    ],
  );
}

export function generateFormResponse() {
  const messageId = generateUniqueId();

  return makeRes(
    "I'll help you build a connection leak monitor. Here's my plan:",
    [
      createArtifact({
        id: "form-artifact-1",
        messageId: messageId,
        type: ArtifactType.FORM,
        content: {
          actionText:
            "Here's my plan to implement the connection leak monitor:",
          webhook: "https://stakwork.com/api/chat/confirm",
          options: [
            {
              actionType: "button",
              optionLabel: "✓ Confirm Plan",
              optionResponse: "confirmed",
            },
            {
              actionType: "button",
              optionLabel: "✗ Modify Plan",
              optionResponse: "modify",
            },
          ],
        },
      }),
    ],
  );
}

export function generateChatFormResponse() {
  const messageId = generateUniqueId();

  return makeRes(
    "I need some additional information to proceed with your request:",
    [
      createArtifact({
        id: "chat-form-artifact-1",
        messageId: messageId,
        type: ArtifactType.FORM,
        content: {
          actionText:
            "Please provide more details about what you'd like me to help you with. You can type your response in the input field below.",
          webhook: "https://stakwork.com/api/chat/details",
          options: [
            {
              actionType: "chat",
              optionLabel: "Provide Details",
              optionResponse: "user_details_provided",
            },
          ],
        },
      }),
    ],
  );
}

export function generateBrowserResponse(baseUrl: string) {
  const messageId = generateUniqueId();

  return makeRes("Here's a live preview of the site:", [
    createArtifact({
      id: "browser-artifact-1",
      messageId: messageId,
      type: ArtifactType.BROWSER,
      content: {
        url: baseUrl,
      },
    }),
  ]);
}

export function generateLongformResponse() {
  const messageId = `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return makeRes("", [
    createArtifact({
      id: "longform-1",
      messageId,
      type: ArtifactType.LONGFORM,
      content: {
        title: "Repomap: Project Hive Overview",
        text: REPOMAP,
      },
    }),
  ]);
}

export function generateGraphResponse(refId: string) {
  const messageId = generateUniqueId();

  return makeRes("Here's the knowledge graph for that reference:", [
    createArtifact({
      id: "graph-artifact-1",
      messageId: messageId,
      type: ArtifactType.GRAPH,
      content: {
        ref_id: refId,
        depth: 2,
      },
    }),
  ]);
}

export function generateBugReportResponse(artifacts: { type: string; content: unknown }[]) {
  // Find BUG_REPORT artifacts
  const bugReportArtifacts = artifacts?.filter(artifact => artifact.type === "BUG_REPORT") || [];
  
  if (bugReportArtifacts.length === 0) {
    return makeRes("No debug information found in the request.");
  }

  // Extract the staktrak data from the first bug report
  const bugReport = bugReportArtifacts[0];
  const content = bugReport.content as any;
  
  // Check if we have source files with formatted message from staktrak
  if (content?.sourceFiles && content.sourceFiles.length > 0) {
    const sourceFile = content.sourceFiles[0];
    
    // If we have a formatted message from staktrak, use it
    if (sourceFile.message) {
      return makeRes(sourceFile.message);
    }
    
    // Fallback: if no formatted message but we have source files
    if (sourceFile.file && sourceFile.file !== "Source mapping will be available in future update") {
      return makeRes(`🐛 Debug info: ${sourceFile.file}${sourceFile.context ? ` - ${sourceFile.context}` : ''}`);
    }
  }

  // Final fallback for old format or missing data
  return makeRes("Debug artifact received. Component analysis in progress...");
}

export function generateResponseBasedOnMessage(
  message: string,
  mockBrowserUrl: string,
  artifacts?: { type: string; content: unknown }[]
) {
  // Check for BUG_REPORT artifacts first
  if (artifacts && artifacts.some(artifact => artifact.type === "BUG_REPORT")) {
    return generateBugReportResponse(artifacts);
  }

  const messageText = message.toLowerCase();

  if (process.env.MOCK_BROWSER_URL) {
    mockBrowserUrl = process.env.MOCK_BROWSER_URL;
  }

  // Check for "graph REF_ID" pattern
  const graphMatch = message.match(/^graph\s+([a-zA-Z0-9-_]+)/i);
  if (graphMatch) {
    const refId = graphMatch[1];
    return generateGraphResponse(refId);
  }

  if (messageText.includes("browser")) {
    return generateBrowserResponse(mockBrowserUrl);
  } else if (messageText.includes("code")) {
    return generateCodeResponse();
  } else if (messageText.includes("chat")) {
    return generateChatFormResponse();
  } else if (messageText.includes("longform")) {
    return generateLongformResponse();
  } else if (messageText.includes("form")) {
    return generateFormResponse();
  } else if (messageText.includes("confirmed")) {
    return makeRes("Ok! Let's move forward with this plan");
  } else if (messageText.includes("modify")) {
    return makeRes("What do you want to modify?");
  } else if (messageText.includes("markdown")) {
    return makeRes(MARKDOWN_EXAMPLE);
  } else {
    return makeRes("Autogenerated response.");
  }
}
