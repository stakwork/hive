/* Note: ported from strut kit/src/channels/protocol.ts at commit 592257144bc683129237c4eca8773a3473b52ec3 (strut main); carry later strut changes over from there. Only the host's subset (no page-side fold). */
/** The CHANNELS contract between an app page and its host: the strut/channels/* methods on the MCP Apps bridge, and the frames strut sends over the host's socket. */
export const CHANNELS_CAPABILITY = "strut/channels";
export const CHANNEL_JOIN_METHOD = "strut/channels/join";
export const CHANNEL_LEAVE_METHOD = "strut/channels/leave";
export const CHANNEL_SEND_METHOD = "strut/channels/send";
export const CHANNEL_FRAME_METHOD = "strut/channels/frame";
export interface ChannelsCapability { v: 1; }
export interface ChannelSender { actor?: string; client?: string; code?: string; }
export interface ChannelMessage { from: ChannelSender; key?: string; data: unknown; at: number; }
export interface ChannelMember { actor?: string; client: string; since: number; }
export type ChannelFrame =
  | { op: "joined"; channel: string; client: string; cursor: string; members: ChannelMember[]; messages: ChannelMessage[]; reset?: true }
  | { op: "message"; channel: string; cursor: string; message: ChannelMessage }
  | { op: "presence"; channel: string; joined?: ChannelMember; left?: ChannelMember }
  | { op: "error"; channel?: string; error: string }
  | { op: "status"; connected: boolean; error?: string };
export const CHANNEL_PASS_THROUGH = {
  "~standard": { version: 1 as const, vendor: "strut", validate: (value: unknown) => ({ value }) },
};
