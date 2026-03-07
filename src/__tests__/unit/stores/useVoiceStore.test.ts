import { describe, test, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

// ---- mock livekit-client — use vi.hoisted so the class is available in factory ----

const { mockPublishData, mockSetMicrophoneEnabled, mockConnect, mockDisconnect, MockRoom } =
  vi.hoisted(() => {
    const mockPublishData = vi.fn().mockResolvedValue(undefined);
    const mockSetMicrophoneEnabled = vi.fn().mockResolvedValue(undefined);
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    const mockDisconnect = vi.fn();

    class MockRoom {
      localParticipant = {
        setMicrophoneEnabled: mockSetMicrophoneEnabled,
        publishData: mockPublishData,
      };
      private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

      on(event: string, cb: (...args: unknown[]) => void) {
        this.listeners[event] = this.listeners[event] ?? [];
        this.listeners[event].push(cb);
        return this;
      }

      emit(event: string, ...args: unknown[]) {
        (this.listeners[event] ?? []).forEach((cb) => cb(...args));
      }

      connect = mockConnect;
      disconnect = mockDisconnect;
    }

    return { mockPublishData, mockSetMicrophoneEnabled, mockConnect, mockDisconnect, MockRoom };
  });

vi.mock("livekit-client", () => ({
  Room: MockRoom,
  RoomEvent: {
    DataReceived: "dataReceived",
    TranscriptionReceived: "transcriptionReceived",
    Disconnected: "disconnected",
  },
}));

// ---- import store AFTER mocks are registered ------------------------------
import { useVoiceStore } from "@/stores/useVoiceStore";

// ---- tests ----------------------------------------------------------------

describe("useVoiceStore — sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVoiceStore.setState({
      room: null,
      isConnected: false,
      isConnecting: false,
      isMicEnabled: false,
      error: null,
      messages: [],
      transcription: null,
    });
  });

  test("no-ops when room is null", () => {
    act(() => {
      useVoiceStore.getState().sendMessage("hello");
    });
    expect(useVoiceStore.getState().messages).toHaveLength(0);
    expect(mockPublishData).not.toHaveBeenCalled();
  });

  test("appends user message optimistically to messages", () => {
    const room = new MockRoom();
    useVoiceStore.setState({ room: room as never, isConnected: true });

    act(() => {
      useVoiceStore.getState().sendMessage("hello world");
    });

    const { messages } = useVoiceStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe("hello world");
    expect(messages[0].sender).toBe("user");
    expect(messages[0].id).toBeTruthy();
    expect(messages[0].timestamp).toBeGreaterThan(0);
  });

  test("calls publishData with lk-chat-topic and encoded payload", () => {
    const room = new MockRoom();
    useVoiceStore.setState({ room: room as never, isConnected: true });

    act(() => {
      useVoiceStore.getState().sendMessage("test message");
    });

    expect(mockPublishData).toHaveBeenCalledOnce();
    const [encoded, opts] = mockPublishData.mock.calls[0];
    expect(opts).toEqual({ topic: "lk-chat-topic", reliable: true });

    const decoded = JSON.parse(new TextDecoder().decode(encoded as Uint8Array));
    expect(decoded.message).toBe("test message");
    expect(decoded.sender).toBe("user");
  });

  test("incoming DataReceived defaults sender to 'agent' when absent", () => {
    const rawMsg = { id: "abc", timestamp: 123456, message: "Hi from agent" };
    const encoded = new TextEncoder().encode(JSON.stringify(rawMsg));

    act(() => {
      const raw = JSON.parse(new TextDecoder().decode(encoded));
      const msg = { sender: "agent" as const, ...raw };
      useVoiceStore.setState((s) => ({ messages: [...s.messages, msg] }));
    });

    const { messages } = useVoiceStore.getState();
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe("agent");
    expect(messages[0].message).toBe("Hi from agent");
  });

  test("incoming DataReceived with explicit sender preserves it", () => {
    const rawMsg = { id: "xyz", timestamp: 789, message: "Echo", sender: "agent" };
    const encoded = new TextEncoder().encode(JSON.stringify(rawMsg));

    act(() => {
      const raw = JSON.parse(new TextDecoder().decode(encoded));
      const msg = { sender: "agent" as const, ...raw };
      useVoiceStore.setState((s) => ({ messages: [...s.messages, msg] }));
    });

    expect(useVoiceStore.getState().messages[0].sender).toBe("agent");
  });
});
