"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { DashboardData } from "@/lib/types";
export function useDashboard() { const [data, setData] = useState<DashboardData | null>(null); const [error, setError] = useState(""); const load = useCallback(() => { setError(""); return api<DashboardData>("/luft/dashboard").then(setData).catch((cause) => setError(errorMessage(cause))); }, []); useEffect(() => { void load(); }, [load]); return { data, error, reload: load }; }
