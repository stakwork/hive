import { useSchemaStore } from "@/stores/useSchemaStore";
import { Node } from "@Universe/types";
import { truncateText } from "@Universe/utils/truncateText";
import { Avatar, TooltipContainer } from "../index";

type Props = {
  node: Node;
};

export const General = ({ node }: Props) => {
  const { getNodeKeysByType } = useSchemaStore((s) => s);

  const keyProperty = getNodeKeysByType(node.node_type) || "";

  let title = "";
  let description = node?.properties?.description || node.properties?.text || "";

  if (node.node_type === "Question") {
    title = node.name || "";
  } else if (node.node_type === "Claim") {
    title = "";
    description = node?.properties?.name || "";
  } else if (node?.properties) {
    title = node.properties[keyProperty] || "";
  }

  return (
    <TooltipContainer>
      <div className="mt-0 flex flex-col gap-1 items-start">
        <div className="flex flex-row">
          {node?.properties?.image_url && <Avatar src={node.properties.image_url} alt={title} />}
          <div className="flex flex-col items-start min-w-0 max-w-full">
            <div className="text-sm text-white/80">{node.node_type}</div>
            {title && (
              <h3 className="font-barlow text-xl font-semibold leading-6 text-white mt-2 overflow-hidden text-ellipsis whitespace-normal min-w-0 max-w-full line-clamp-3">
                {truncateText(title, 70)}
              </h3>
            )}
          </div>
        </div>
        {description && (
          <p className="font-barlow text-sm font-normal leading-5 mt-4 text-white/80 whitespace-normal overflow-hidden text-ellipsis line-clamp-3">
            {description}
          </p>
        )}
      </div>
    </TooltipContainer>
  );
};
