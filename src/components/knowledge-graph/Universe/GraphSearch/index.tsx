import ClearIcon from "@/components/Icons/ClearIcon";
import SearchIcon from "@/components/Icons/SearchIcon";
import { useGraphStore } from "@/stores/useStores";
import { GraphFilter } from "./GraphFilter";

export const GraphSearch = () => {
  const searchQuery = useGraphStore((s) => s.searchQuery);
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery);

  return (
    <div className="absolute top-0 right-0 left-0 z-[100] flex flex-col items-center px-4 pt-4">
      {/* Glass morphism background for better visual separation */}
      <div className="flex flex-row items-center justify-end w-full mx-auto gap-4 p-3 rounded-2xl bg-black/20 backdrop-blur-md border border-white/10 shadow-2xl">
        {/* Enhanced search input with modern styling */}
        <div className="relative flex flex-row w-72 group">
          <input
            id="graph-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search graph..."
            autoCorrect="off"
            autoComplete="off"
            className="
              box-border pointer-events-auto h-10 px-4 pr-12 z-[2] w-full
              border border-gray-600/50 rounded-xl bg-gray-900/80 backdrop-blur-sm
              text-sm font-medium text-white placeholder-gray-400
              focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400/50
              hover:border-gray-500/50 hover:bg-gray-800/80
              transition-all duration-300 ease-out
              shadow-inner
            "
          />

          {searchQuery?.trim() ? (
            <button
              data-testid="search_action_icon"
              onClick={() => setSearchQuery("")}
              className="
                absolute right-3 top-1/2 -translate-y-1/2 z-[2]
                flex items-center justify-center w-6 h-6 rounded-md
                text-gray-400 hover:text-white hover:bg-white/10
                cursor-pointer transition-all duration-200
                active:scale-95
              "
              title="Clear search"
            >
              <ClearIcon className="w-4 h-4" />
            </button>
          ) : (
            <div
              className="
              absolute right-3 top-1/2 -translate-y-1/2 z-[3]
              flex items-center justify-center w-6 h-6
              pointer-events-none transition-all duration-200
              group-focus-within:text-blue-400 text-gray-500
            "
            >
              <SearchIcon className="w-5 h-5" />
            </div>
          )}
        </div>

        {/* Filter component with consistent styling */}
        <GraphFilter />
      </div>
    </div>
  );
};
