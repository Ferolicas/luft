import type { Metadata } from "next";
import { RegisterScreen } from "@/components/luft/auth";
export const metadata: Metadata = { title: "Crear cuenta" };
export default function RegisterPage() { return <RegisterScreen />; }
