"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Github, Unlink } from "lucide-react";

interface DisconnectAccountProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
    github?: {
      username?: string;
      publicRepos?: number;
      followers?: number;
    };
  };
}

export function DisconnectAccount({ user }: DisconnectAccountProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (
      !confirm(
        "Are you sure you want to disconnect your GitHub account? This will revoke access to your GitHub data and you'll need to reconnect to use the app.",
      )
    ) {
      return;
    }

    setIsDisconnecting(true);

    try {
      // First, revoke the GitHub OAuth access token
      const response = await fetch("/api/auth/revoke-github", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to revoke GitHub access");
      }

      // Clear any potential browser cache/storage
      if (typeof window !== "undefined") {
        // Clear localStorage and sessionStorage
        localStorage.clear();
        sessionStorage.clear();

        // Clear any NextAuth cookies
        document.cookie.split(";").forEach(function (c) {
          document.cookie = c
            .replace(/^ +/, "")
            .replace(
              /=.*/,
              "=;expires=" + new Date().toUTCString() + ";path=/",
            );
        });
      }

      // Then sign out the user with a fresh redirect
      await signOut({
        callbackUrl: "/",
        redirect: true,
      });
    } catch (error) {
      console.error("Error disconnecting account:", error);
      setIsDisconnecting(false);
      alert("Failed to disconnect GitHub account. Please try again.");
    }
  };

  if (!user.github) {
    return (
      <div className="text-center py-8">
        <Github className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No GitHub account connected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
        <Github className="w-8 h-8 text-foreground" />
        <div className="flex-1">
          <div className="font-medium">@{user.github.username}</div>
          <div className="text-sm text-muted-foreground">
            {user.github.publicRepos} public repos • {user.github.followers}{" "}
            followers
          </div>
        </div>
        <div className="text-sm text-green-600 font-medium">Connected</div>
      </div>

      <div className="border-t pt-4">
        <Button
          variant="destructive"
          onClick={handleDisconnect}
          disabled={isDisconnecting}
          className="w-full"
        >
          <Unlink className="w-4 h-4 mr-2" />
          {isDisconnecting ? "Disconnecting..." : "Disconnect GitHub Account"}
        </Button>

        <p className="text-xs text-muted-foreground mt-2 text-center">
          This will revoke access to your GitHub data and sign you out of the
          application.
        </p>
      </div>
    </div>
  );
}
