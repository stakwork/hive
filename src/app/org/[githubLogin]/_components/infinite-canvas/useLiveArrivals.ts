import { useEffect, useRef, useState, type RefObject } from "react";
import { ARRIVE_MS, computeArrivals, viewRect, type ArrivalMemory, type ArrivalNode } from "./arrivals";
import type { Camera, Viewport } from "./scene";

/** Cards playing their arrival: id → ms to wait before it starts. */
export type Arriving = ReadonlyMap<string, { delayMs: number }>;
const NONE: Arriving = new Map();

/**
 * Runs `computeArrivals` whenever the data cards change, and holds the ones playing their `icb-arrive`
 * animation until it has ended. Additions off screen are handed to `onOffView` (not animated).
 */
export function useLiveArrivals({
  nodes,
  unloaded,
  ready,
  camRef,
  vp,
  own,
  onOffView,
}: {
  nodes: ArrivalNode[];
  unloaded: ReadonlySet<string>;
  ready: boolean;
  camRef: RefObject<Camera | null>;
  vp: Viewport | null;
  /** Ids the user's own saves created (never a live arrival). */
  own: RefObject<Set<string>>;
  onOffView?: (ids: string[]) => void;
}): Arriving {
  const [arriving, setArriving] = useState<Arriving>(NONE);
  const memory = useRef<ArrivalMemory | null>(null);
  const live = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const offRef = useRef(onOffView);
  offRef.current = onOffView;

  useEffect(() => {
    if (!ready) return;
    const cam = camRef.current;
    const r = computeArrivals({
      prev: memory.current,
      nodes,
      unloaded,
      ready,
      view: cam && vp ? viewRect(cam, vp) : null,
      own: own.current,
      active: live.current.size,
    });
    memory.current = r.next;
    for (const id of own.current) if (r.next.seen.has(id)) own.current.delete(id);
    if (r.offView.length) offRef.current?.(r.offView);
    if (!r.inView.length) return;
    setArriving((cur) => {
      const m = new Map(cur);
      for (const a of r.inView) m.set(a.id, { delayMs: a.delayMs });
      return m;
    });
    for (const a of r.inView) {
      live.current.set(
        a.id,
        setTimeout(
          () => {
            live.current.delete(a.id);
            setArriving((cur) => {
              if (!cur.has(a.id)) return cur;
              const m = new Map(cur);
              m.delete(a.id);
              return m;
            });
          },
          a.delayMs + ARRIVE_MS + 100,
        ),
      );
    }
  }, [nodes, unloaded, ready, camRef, vp, own]);

  useEffect(() => {
    const timers = live.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  return arriving;
}
