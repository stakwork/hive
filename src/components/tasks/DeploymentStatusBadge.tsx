import React from "react";
import { Badge } from "@/components/ui/badge";
import { Rocket, CheckCircle2, XCircle, ExternalLink } from "lucide-react";

interface DeploymentStatusBadgeProps {
  environment: "staging" | "production" | "failed";
  deploymentUrl?: string | null;
  deployedAt?: Date | string | null;
}

export function DeploymentStatusBadge({
  environment,
  deploymentUrl,
}: DeploymentStatusBadgeProps) {
  const config = {
    staging: {
      color: "text-purple-600 border-purple-300 bg-purple-50",
      icon: Rocket,
      label: "Staging",
    },
    production: {
      color: "text-green-600 border-green-300 bg-green-50",
      icon: CheckCircle2,
      label: "Production",
    },
    failed: {
      color: "text-red-600 border-red-300 bg-red-50",
      icon: XCircle,
      label: "Failed",
    },
  };

  const { color, icon: Icon, label } = config[environment];

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deploymentUrl) {
      window.open(deploymentUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Badge
      variant="outline"
      className={`${color} cursor-pointer hover:opacity-80 transition-opacity`}
      onClick={handleClick}
    >
      <Icon className="w-3 h-3 mr-1" />
      {label}
      {deploymentUrl && <ExternalLink className="w-3 h-3 ml-1" />}
    </Badge>
  );
}
