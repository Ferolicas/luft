import type { Metadata } from "next";
import { AuthFrame } from "@/components/luft/desktop";

export const metadata: Metadata = { title: "Invitación a un hogar LUFT", robots: { index: false, follow: false } };

export default function InvitationLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <AuthFrame>{children}</AuthFrame>; }
