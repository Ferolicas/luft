import type { Metadata } from "next";
import { StartFlow } from "./start-flow";

export const metadata: Metadata = { title: "Empecemos", description: "Cuéntanos qué te trae a LUFT y adapta la app a lo que necesitas." };
export default function StartPage() { return <StartFlow />; }
