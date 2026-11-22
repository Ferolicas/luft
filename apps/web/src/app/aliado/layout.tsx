import type { Metadata } from "next";
import { ConsoleShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "Portal de aliado", robots: { index: false, follow: false } };

export default function AllyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ConsoleShell area="aliado">{children}</ConsoleShell>;
}
