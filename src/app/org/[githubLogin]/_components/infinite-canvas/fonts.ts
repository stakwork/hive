import { Patrick_Hand, Source_Serif_4 } from "next/font/google";

/** Handwriting: what a person wrote. */
export const hand = Patrick_Hand({ weight: "400", subsets: ["latin"], display: "swap" });
/** What strut or Jamie wrote, and the canvas's own words: typeset. */
export const serif = Source_Serif_4({ subsets: ["latin"], display: "swap" });
