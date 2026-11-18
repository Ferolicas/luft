import type { Metadata } from "next";
import { RecoveryScreen } from "@/components/luft/auth";
export const metadata: Metadata = { title: "Recupera tu acceso" };
export default function RecoveryPage() { return <RecoveryScreen />; }
