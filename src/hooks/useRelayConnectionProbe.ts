"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type RelayProbeStatus =
  | "idle"
  | "fetching-token"
  | "connecting"
  | "connected"
  | "error";

interface UseRelayConnectionProbeOptions {
  whiteboardId: string | null;
  enabled?: boolean;
}

interface UseRelayConnectionProbeReturn {
  status: RelayProbeStatus;
  error: string | null;
}

/**
 * Opens a socket.io connection to the per-swarm hive-relay using a
 * capability JWT from /api/whiteboards/[id]/relay-token. Does not send or
 * receive collaboration events — its only job is to confirm the handshake
 * works end-to-end. Runs alongside the existing Pusher-based flow and is
 * expected to be removed once the relay migration lands.
 */
export function useRelayConnectionProbe({
  whiteboardId,
  enabled = true,
}: UseRelayConnectionProbeOptions): UseRelayConnectionProbeReturn {
  const [status, setStatus] = useState<RelayProbeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled || !whiteboardId) return;

    let cancelled = false;

    (async () => {
      setStatus("fetching-token");
      setError(null);

      let tokenResponse: { token: string; url: string };
      try {
        const res = await fetch(
          `/api/whiteboards/${whiteboardId}/relay-token`,
        );
        if (!res.ok) {
          if (cancelled) return;
          const body = await res.json().catch(() => null);
          setStatus("error");
          setError(
            `token endpoint ${res.status}${body?.reason ? ` (${body.reason})` : ""}`,
          );
          return;
        }
        tokenResponse = await res.json();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
        return;
      }

      if (cancelled) return;
      setStatus("connecting");

      const socket = io(tokenResponse.url, {
        auth: { token: tokenResponse.token },
        transports: ["websocket"],
        reconnection: false,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        if (cancelled) return;
        setStatus("connected");
        setError(null);
        console.info("[relay-probe] connected", {
          url: tokenResponse.url,
          sid: socket.id,
        });
      });

      socket.on("connect_error", (err) => {
        if (cancelled) return;
        setStatus("error");
        setError(err.message);
        console.warn("[relay-probe] connect_error", err.message);
      });

      socket.on("disconnect", (reason) => {
        console.info("[relay-probe] disconnected", reason);
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [whiteboardId, enabled]);

  return { status, error };
}
