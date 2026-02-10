import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

/**
 * Information about a collaborator currently viewing the whiteboard
 */
export interface CollaboratorInfo {
  odinguserId: string;
  name: string;
  image: string | null;
  color: string;
  joinedAt: number;
}

/**
 * Cursor position for a collaborator
 */
export interface CollaboratorCursor {
  odinguserId: string;
  x: number;
  y: number;
  color: string;
}

/**
 * Event for element updates broadcast via Pusher
 */
export interface WhiteboardElementsUpdateEvent {
  senderId: string;
  elements: ExcalidrawElement[];
  appState: Partial<AppState>;
  version: number;
}

/**
 * Event for cursor position updates (ephemeral, not persisted)
 */
export interface WhiteboardCursorUpdateEvent {
  senderId: string;
  cursor: {
    x: number;
    y: number;
  };
  color: string;
  username?: string;
}

/**
 * Event for user joining the whiteboard
 */
export interface WhiteboardUserJoinEvent {
  user: CollaboratorInfo;
}

/**
 * Event for user leaving the whiteboard
 */
export interface WhiteboardUserLeaveEvent {
  userId: string;
}

/**
 * Payload for collaboration API requests
 */
export interface CollaborationEventPayload {
  type: "cursor" | "join" | "leave";
  senderId?: string;
  cursor?: { x: number; y: number };
  color?: string;
  user?: CollaboratorInfo;
}

/**
 * Excalidraw collaborator format for rendering cursors
 */
export interface ExcalidrawCollaborator {
  username?: string;
  avatarUrl?: string;
  pointer?: {
    x: number;
    y: number;
  };
  color?: {
    background: string;
    stroke: string;
  };
}
