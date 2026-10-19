"use client";

import { createContext, useContext } from "react";
import type { ControlPanelListProps } from "../control-panel/ControlPanelList";

interface MobileOrgContextValue {
  /** Slides the navigation drawer in. */
  openDrawer: () => void;
  /** The chat list's state, held once by the shell for the drawer and the chat's actions; null outside it. */
  chatList: Omit<ControlPanelListProps, "onHide"> | null;
}

export const MobileOrgContext = createContext<MobileOrgContextValue>({
  openDrawer: () => {},
  chatList: null,
});

/** What a mobile screen can ask of the shell around it. */
export function useMobileOrg(): MobileOrgContextValue {
  return useContext(MobileOrgContext);
}
