import { ActionsToolbar } from "./ActionsToolbar";

export const Overlay = () => (
  <div className="absolute top-0 left-0 select-none pointer-events-none flex justify-end items-start h-full w-full p-4 pr-0 overflow-hidden sm:top-0 max-sm:top-[50px]">
    <ActionsToolbar />
  </div>
);
