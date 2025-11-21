import { Container, FileText, Package, Settings } from "lucide-react";

export const FileIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "json":
      return <Settings className="w-3 h-3" />;
    case "javascript":
      return <FileText className="w-3 h-3" />;
    case "yaml":
      return <Package className="w-3 h-3" />;
    case "dockerfile":
      return <Container className="w-3 h-3" />;
    default:
      return <FileText className="w-3 h-3" />;
  }
};
