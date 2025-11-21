"use client";

import { ModalProvider } from "@/components/modals/ModlaProvider";
import ServicesModal from "@/components/modals/ServicesModal";

const registry = {
  ServicesWizard: ServicesModal,
};

export default function ModalClient({ children }: { children: React.ReactNode }) {
  return <ModalProvider registry={registry}>{children}</ModalProvider>;
}
