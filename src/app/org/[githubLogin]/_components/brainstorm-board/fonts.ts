import { Patrick_Hand, VT323 } from "next/font/google";

/** Handwriting: a person's notes, the zone headings. */
export const hand = Patrick_Hand({ weight: "400", subsets: ["latin"], display: "swap" });
/** Terminal: what the agent wrote. */
export const mono = VT323({ weight: "400", subsets: ["latin"], display: "swap" });
