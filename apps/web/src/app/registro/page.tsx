import type { Metadata } from "next";
import { AuthFrame, RegisterForm } from "@/components/auth-card";
export const metadata: Metadata = { title: "Crear cuenta" };
export default function RegisterPage() { return <AuthFrame title="Crea tu cuenta LUFT" description="Empecemos por conocerte. Te tomará pocos minutos."><RegisterForm /></AuthFrame>; }
