import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { WhatIfResult } from "../../types";

type Props = {
  shiftId: string;
  staffId: string;
  enabled: boolean;
};

export function WhatIfPanel({ shiftId, staffId, enabled }: Props) {
  const query = useQuery({
    queryKey: ["what-if", shiftId, staffId],
    enabled,
    queryFn: async () => {
      const response = await api.get<{ result: WhatIfResult }>("/analytics/what-if", {
        params: { shiftId, staffId },
      });
      return response.data.result;
    },
  });

  return (
    <Card className="border-blue-100">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-600" />
          <div>
            <CardTitle>What-If Analysis</CardTitle>
            <CardDescription className="mt-0.5">
              Projected impact of assigning this staff member to the shift.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!enabled ? (
          <p className="text-sm text-slate-400">
            Enter a valid staff ID above to see impact analysis.
          </p>
        ) : query.isLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
            <span className="text-sm">Calculating…</span>
          </div>
        ) : query.isError ? (
          <p className="text-sm text-red-500">Could not load what-if analysis.</p>
        ) : query.data ? (
          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock size={12} className="text-slate-400" />
                  <span className="text-xs text-slate-500">Daily hrs</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{query.data.projectedDailyHours}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock size={12} className="text-slate-400" />
                  <span className="text-xs text-slate-500">Weekly hrs</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{query.data.projectedWeeklyHours}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <span className="text-xs text-slate-500">Consec. days</span>
                </div>
                <p className="text-lg font-bold text-slate-900">{query.data.consecutiveDays}</p>
              </div>
            </div>

            {/* Warnings */}
            {query.data.warnings.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Warnings</p>
                <ul className="space-y-1.5">
                  {query.data.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2"
                    >
                      <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-sm text-amber-700">{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {query.data.warnings.length === 0 && (
              <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2.5">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm text-green-700 font-medium">No constraint warnings for this assignment.</span>
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
