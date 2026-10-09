import { getStoreBundle } from "@/stores/createStoreFactory";
import { useStoreId } from "@/stores/StoreProvider";
import { useControlStore } from "@/stores/useControlStore";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

// The canvas runs frameloop="demand". Keep rendering for this long after the last store change,
// simulation tick or pointer event so one-shot imperative updates (gsap tweens, edge highlight
// rebuilds, camera damping) finish before the loop sleeps. Continuous animations invalidate themselves.
const ACTIVE_WINDOW_MS = 2000;

const POINTER_EVENTS = ["pointermove", "pointerdown", "wheel"] as const;

export const FrameloopGate = () => {
  const storeId = useStoreId();
  const invalidate = useThree((s) => s.invalidate);
  const eventTarget = useThree((s) => s.events.connected) as HTMLElement | undefined;
  const lastActivity = useRef(performance.now());

  useEffect(() => {
    const wake = () => {
      lastActivity.current = performance.now();
      invalidate();
    };

    const { data, graph, simulation } = getStoreBundle(storeId);

    let sim = simulation.getState().simulation;
    sim?.on("tick.frameloop", wake);

    const unsubscribers = [
      data.subscribe(wake),
      graph.subscribe(wake),
      useControlStore.subscribe(wake),
      simulation.subscribe((state) => {
        if (state.simulation !== sim) {
          sim?.on("tick.frameloop", null);
          sim = state.simulation;
          sim?.on("tick.frameloop", wake);
        }
        wake();
      }),
    ];

    POINTER_EVENTS.forEach((type) => eventTarget?.addEventListener(type, wake, { passive: true }));
    wake();

    return () => {
      sim?.on("tick.frameloop", null);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      POINTER_EVENTS.forEach((type) => eventTarget?.removeEventListener(type, wake));
    };
  }, [storeId, invalidate, eventTarget]);

  useFrame((state) => {
    if (performance.now() - lastActivity.current < ACTIVE_WINDOW_MS) {
      state.invalidate();
    }
  });

  return null;
};
