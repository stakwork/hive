import { useToastContext } from "./toast-provider";
import { ToastProps } from "./toast";

export function useToast() {
  const { showToast } = useToastContext();
  return {
    toast: (opts: Omit<ToastProps, "open" | "onOpenChange">) => showToast(opts),
  };
}
