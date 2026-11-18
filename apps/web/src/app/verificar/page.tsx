import type { Metadata } from "next";
import { VerifyScreen } from "@/components/luft/auth";
export const metadata: Metadata = { title: "Verifica tu celular" };
export default function VerifyPage() { return <VerifyScreen />; }
