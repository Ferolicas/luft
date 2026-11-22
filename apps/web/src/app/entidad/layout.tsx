import type { Metadata } from "next";
import { ConsoleShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "Portal de entidad financiera", robots: { index: false, follow: false } };

export default function InstitutionLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ConsoleShell area="entidad">{children}</ConsoleShell>;
}
