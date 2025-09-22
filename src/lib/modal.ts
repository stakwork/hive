import { useModalStore } from "@/stores/useModalsStore";

export const modal = {
  open: (name: string, props?: Record<string, unknown>) =>
    useModalStore.getState().open(name, props),
};
