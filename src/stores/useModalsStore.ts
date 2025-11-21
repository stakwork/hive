import { create } from "zustand";

export type ModalInstance = {
  id: string;
  name: string;
  props?: Record<string, unknown>;
  resolve?: (value: unknown) => void;
  reject?: (reason?: unknown) => void;
};

type ModalState = {
  instances: ModalInstance[];
  open: (name: string, props?: Record<string, unknown>) => Promise<unknown>;
  resolve: (id: string, value?: unknown) => void;
  reject: (id: string, reason?: unknown) => void;
  dismissTop: () => void;
};

export const useModalStore = create<ModalState>((set, get) => ({
  instances: [],
  open: (name, props) =>
    new Promise((resolve, reject) => {
      const id = `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      set((s) => ({ instances: [...s.instances, { id, name, props, resolve, reject }] }));
    }),
  resolve: (id, value) => {
    const { instances } = get();
    const inst = instances.find((i) => i.id === id);
    inst?.resolve?.(value);
    set({ instances: instances.filter((i) => i.id !== id) });
  },
  reject: (id, reason) => {
    const { instances } = get();
    const inst = instances.find((i) => i.id === id);
    inst?.reject?.(reason);
    set({ instances: instances.filter((i) => i.id !== id) });
  },
  dismissTop: () => {
    const { instances } = get();
    const top = instances.at(-1);
    if (top) get().reject(top.id, "dismissed");
  },
}));
