"use client";

import { useModalStore } from "@/stores/useModalsStore";
import React from "react";
import { createPortal } from "react-dom";

export type ModalComponentProps<T = any> = T & {
  onResolve: (value?: unknown) => void;
  onReject: (reason?: unknown) => void;
};

type Registry = Record<string, React.ComponentType<ModalComponentProps>>;

const ModalContext = React.createContext<{
  open: (name: string, props?: Record<string, unknown>) => Promise<unknown>;
} | null>(null);

export function ModalProvider({ registry, children }: React.PropsWithChildren<{ registry: Registry }>) {
  const open = useModalStore(s => s.open);
  return (
    <ModalContext.Provider value={{ open }}>
      {children}
      <ModalRoot registry={registry} />
    </ModalContext.Provider>
  );
}

function ModalRoot({ registry }: { registry: Registry }) {
  const { instances, resolve, reject } = useModalStore();
  const [mounted, setMounted] = React.useState(false);

  // Only portal on client
  React.useEffect(() => setMounted(true), []);

  // Simple page scroll lock while any modal is open
  React.useEffect(() => {
    if (!mounted) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    if (instances.length > 0) html.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev;
    };
  }, [instances.length, mounted]);

  if (!mounted) return null;
  return createPortal(
    <>
      {instances.map(inst => {
        const Cmp = registry[inst.name];
        if (!Cmp) return null;
        return (
          <Cmp
            key={inst.id}
            {...(inst.props as any)}
            onResolve={(v) => resolve(inst.id, v)}
            onReject={(r) => reject(inst.id, r)}
          />
        );
      })}
    </>,
    document.body
  );
}

export function useModal() {
  const ctx = React.useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within <ModalProvider />");
  return ctx.open;
}
