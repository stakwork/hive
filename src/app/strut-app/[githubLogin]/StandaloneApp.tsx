"use client";

import React, { useCallback, useMemo } from "react";
import { StrutAppFrame } from "@/components/strut-app-frame";
import { strutAppInputOf } from "@/lib/strut-apps";
import { strutViewPath } from "@/lib/utils/strut-links";

/** The app, filling the viewport. No conversation here, so a `ui/message` from it has nowhere to go and is left unhandled. */
export function StandaloneApp({ githubLogin, swarmId, app, version, input }: { githubLogin: string; swarmId: string; app: string; version?: string; input?: string }) {
  const toolInput = useMemo(() => strutAppInputOf(input), [input]);
  const strutLinkHref = useCallback((deepLink: string) => strutViewPath(githubLogin, deepLink), [githubLogin]);
  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <StrutAppFrame
        source={{ githubLogin, swarmId, app, ...(version ? { version } : {}) }}
        title={app}
        strutLinkHref={strutLinkHref}
        {...(toolInput ? { toolInput } : {})}
      />
    </div>
  );
}
