import type { Metadata } from "next";
import { AuthFrame, VerifyForm } from "@/components/auth-card";
export const metadata: Metadata = { title: "Verifica tu celular" };
export default function VerifyPage() { return <AuthFrame title="Confirma que eres tú" description="Enviamos un código de seis dígitos al celular que registraste."><VerifyForm /></AuthFrame>; }
