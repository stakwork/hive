"use client";

import * as React from "react";
import { Toast, ToastProps } from "./toast";

interface ToastContextType {
  showToast: (toast: Omit<ToastProps, "open" | "onOpenChange">) => void;
}

const ToastContext = React.createContext<ToastContextType | undefined>(
  undefined,
);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [toasts, setToasts] = React.useState<
    Array<ToastProps & { id: number }>
  >([]);
  const toastId = React.useRef(0);

  const showToast = React.useCallback(
    (toast: Omit<ToastProps, "open" | "onOpenChange">) => {
      const id = toastId.current++;
      setToasts((prev) => [
        ...prev,
        { ...toast, id, open: true } as ToastProps & { id: number },
      ]);
      if (toast.duration !== 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, toast.duration ?? 3000);
      }
    },
    [],
  );

  const handleOpenChange = (id: number, open: boolean) => {
    if (!open) setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed z-[9999] top-4 right-4 flex flex-col gap-2 max-w-xs">
        {toasts.map(({ id, ...toast }) => (
          <Toast
            key={id}
            {...toast}
            open={toast.open}
            onOpenChange={(open) => handleOpenChange(id, open)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToastContext() {
  const ctx = React.useContext(ToastContext);
  if (!ctx)
    throw new Error("useToastContext must be used within a ToastProvider");
  return ctx;
}
