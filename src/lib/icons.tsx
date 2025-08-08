import { Code, Bot, Phone, MessageSquare } from "lucide-react";

export const getIcon = (iconType: string, className = "h-4 w-4") => {
  const icons = {
    code: <Code className={className} />,
    agent: <Bot className={className} />,
    call: <Phone className={className} />,
    message: <MessageSquare className={className} />
  };
  return icons[iconType?.toLowerCase() as keyof typeof icons] || null;
};

export const getArtifactIcon = (iconType: string) => {
  return getIcon(iconType, "h-5 w-5 flex-shrink-0");
};

export const getAgentIcon = (className = "h-4 w-4 flex-shrink-0") => {
  return <Bot className={className} />;
};