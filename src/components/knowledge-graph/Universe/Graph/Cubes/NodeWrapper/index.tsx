import { NodeExtended } from "@Universe/types";
import { memo } from "react";
import { TextNode } from "../Text/index";

type Props = {
  node: NodeExtended;
  scale: number;
  isFixed: boolean;
};

export const NodeWrapper = memo(
  (props: Props) => {
    const { node, isFixed, scale } = props;

    return (
      <mesh key={node.ref_id} name="wr2" userData={node}>
        <mesh name="text-node-wrapper" visible={isFixed}>
          <TextNode key={node.ref_id} node={node} scale={scale} />
        </mesh>
      </mesh>
    );
  },
  (prevProps, nextProps) => prevProps.isFixed === nextProps.isFixed && prevProps.scale === nextProps.scale,
);

NodeWrapper.displayName = "NodeWrapper";
