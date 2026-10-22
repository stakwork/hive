import { createContext, useContext } from "react";

/**
 * True inside the infinite canvas, whose paper stays light in either app
 * theme: a viewer that picks its colours in script (not by CSS) reads this to
 * stay light there.
 */
export const OnPaper = createContext(false);
export const useOnPaper = () => useContext(OnPaper);
