import { truncateText } from "@Universe/utils/truncateText";
import { Html } from "@react-three/drei";
import { BadgeProps } from "../types";

export const GroupBadge = ({ position, name, count, onClick, isActive }: BadgeProps) => (
  <group position={position}>
    <Html center distanceFactor={250} sprite transform zIndexRange={[0, 0]}>
      <div
        className={`relative text-white bg-black p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
          isActive ? "border-blue-500 bg-blue-900/30" : "border-gray-700 hover:border-gray-600"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation();
            onClick();
          }
        }}
        tabIndex={0}
        role="button"
        aria-label={`${name} - ${count} items`}
      >
        {name ? <span className="text-sm font-medium">{truncateText(name, 15)}</span> : null}
        <div
          className="absolute top-0 right-0 flex items-center justify-center bg-blue-600 text-white text-xs font-medium min-w-4 h-4 rounded-full transform translate-x-1/2 -translate-y-1/2 px-1"
          style={{
            fontSize: "8px",
            fontWeight: "500",
            minWidth: "16px",
            height: "16px",
            padding: "2px",
          }}
        >
          {count}
        </div>
      </div>
    </Html>
  </group>
);
