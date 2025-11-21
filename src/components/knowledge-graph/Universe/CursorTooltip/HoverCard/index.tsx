import { Node } from "@Universe/types";
import { General } from "./General";
import { Tweet } from "./Tweet";
import { User } from "./User";

type Props = {
  node: Node;
};

const ComponentsMapper: Record<string, React.FC<{ node: Node }>> = {
  Tweet,
  User,
  General,
};

export const HoverCard = ({ node }: Props) => {
  // Select component dynamically, fallback to General
  const DynamicComponent = ComponentsMapper[node.node_type] || General;

  return <DynamicComponent node={node} />;
};

export const TooltipContainer = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div
    className={`w-fit bg-gray-800 flex flex-col pointer-events-auto items-start rounded-lg overflow-hidden max-w-[390px] border-b-[5px] border-black/30 p-4 ${className}`}
  >
    {children}
  </div>
);

export const Avatar = ({ src, alt, className = "" }: { src: string; alt: string; className?: string }) => (
  <img src={src} alt={alt} className={`w-8 h-8 rounded-full object-cover mr-2 ${className}`} />
);
