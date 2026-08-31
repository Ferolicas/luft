import type { Metadata } from "next";
import { AuthFrame, LoginForm } from "@/components/auth-card";
export const metadata: Metadata = { title: "Entrar" };
export default function LoginPage() { return <AuthFrame title="Qué bueno verte de nuevo" description="Continúa construyendo tu ruta financiera."><LoginForm /></AuthFrame>; }
