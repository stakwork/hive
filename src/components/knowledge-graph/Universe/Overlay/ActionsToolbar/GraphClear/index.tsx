import ClearIcon from "@/components/Icons/ClearIcon";
import { useDataStore } from "@/stores/useStores";

export const GraphClear = () => {
  const { resetGraph } = useDataStore((s) => s);

  return (
    <div title="Clear Graph">
      <button
        onClick={() => resetGraph()}
        className="p-0 w-8 min-w-0 flex justify-center items-center pointer-events-auto bg-transparent border-none cursor-pointer hover:bg-black/10 rounded transition-colors"
      >
        <div className="text-white brightness-[0.65]">
          <ClearIcon />
        </div>
      </button>
    </div>
  );
};
