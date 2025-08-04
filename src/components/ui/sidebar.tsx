"use client";

import * as React from "react";

const SidebarMenuContext = React.createContext({ isMobile: false });

export function useSidebar() {
  return React.useContext(SidebarMenuContext);
}

export function SidebarMenu({ children }: { children: React.ReactNode }) {
  return <ul className="list-none p-0 m-0">{children}</ul>;
}

export function SidebarMenuItem({ children }: { children: React.ReactNode }) {
  return <li className="w-full">{children}</li>;
}

export function SidebarMenuButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) {
  return (
    <button
      className={`flex items-center gap-2 w-full rounded-md px-2 py-2 text-sm hover:bg-accent transition-colors ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
