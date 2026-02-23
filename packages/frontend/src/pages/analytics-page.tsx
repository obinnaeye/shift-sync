import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, Star, TrendingUp, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import type { FairnessReport, Location, OvertimeEntry } from "../types";
import { toWeekMondayIso } from "../utils/time";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function OvertimeRiskBadge({ risk }: { risk: string }) {
  if (risk === "OVER_LIMIT") return <Badge variant="destructive">Over Limit</Badge>;
  if (risk === "AT_LIMIT") return <Badge variant="destructive">At Limit</Badge>;
  if (risk === "WARNING") return <Badge variant="warning">Warning</Badge>;
  return <Badge variant="secondary">Low</Badge>;
}

export function AnalyticsPage() {
  const [locationId, setLocationId] = useState("");
  const [week, setWeek] = useState(toWeekMondayIso());
  const [weekFrom, setWeekFrom] = useState(toWeekMondayIso());

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const response = await api.get<{ locations: Location[] }>("/locations");
      return response.data.locations;
    },
  });

  const fairnessQuery = useQuery({
    queryKey: ["fairness", locationId, weekFrom],
    queryFn: async () => {
      const response = await api.get<FairnessReport>("/analytics/fairness", {
        params: {
          ...(locationId ? { locationId } : {}),
          ...(weekFrom ? { weekFrom } : {}),
        },
      });
      return response.data;
    },
  });

  const overtimeQuery = useQuery({
    queryKey: ["overtime", locationId, week],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const response = await api.get<{ summary: OvertimeEntry[] }>("/analytics/overtime", {
        params: { locationId, week },
      });
      return response.data.summary;
    },
  });

  const fairnessData = fairnessQuery.data;
  const overtimeData = overtimeQuery.data ?? [];

  const maxHours = useMemo(
    () => Math.max(...(fairnessData?.report ?? []).map((e) => e.totalHours), 1),
    [fairnessData],
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100">
          <BarChart3 size={18} className="text-violet-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Schedule Analytics</h1>
          <p className="text-sm text-slate-500">
            Fairness reports, premium shift equity, and overtime visibility.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Location (optional)</Label>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">All locations</option>
            {(locationsQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Fairness: from week</Label>
          <input
            type="date"
            value={weekFrom}
            onChange={(e) => setWeekFrom(e.target.value)}
            className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Overtime: week</Label>
          <input
            type="date"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
            className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-1"
          />
        </div>
      </div>

      {/* Fairness summary cards */}
      {fairnessData && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-100">
                  <TrendingUp size={16} className="text-violet-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Fairness Score</p>
                  <p className="text-2xl font-bold text-slate-900">{fairnessData.premiumFairnessScore}<span className="text-sm font-normal text-slate-400">/100</span></p>
                </div>
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
                <div
                  className={cn(
                    "h-2 rounded-full transition-all",
                    fairnessData.premiumFairnessScore >= 80 ? "bg-green-500" :
                    fairnessData.premiumFairnessScore >= 50 ? "bg-amber-500" : "bg-red-500",
                  )}
                  style={{ width: `${fairnessData.premiumFairnessScore}%` }}
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100">
                  <Star size={16} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Premium Shifts</p>
                  <p className="text-2xl font-bold text-slate-900">{fairnessData.totalPremiumShifts}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                  <Clock size={16} className="text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Avg Hours/Person</p>
                  <p className="text-2xl font-bold text-slate-900">{fairnessData.avgHours}h</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Distribution report */}
      <Card>
        <CardHeader>
          <CardTitle>Hours Distribution</CardTitle>
          <CardDescription>
            Scheduled hours per staff member, with premium shift counts highlighted in amber.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {fairnessQuery.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-slate-400">
              <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
              <span className="text-sm">Loading report…</span>
            </div>
          ) : (fairnessData?.report ?? []).length === 0 ? (
            <p className="text-sm text-slate-400 py-4">No scheduling data found for the selected period.</p>
          ) : (
            <div className="space-y-3">
              {fairnessData!.report.map((entry) => (
                <div key={entry.userId}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-semibold text-slate-600 select-none">
                        {entry.firstName[0]}{entry.lastName[0]}
                      </div>
                      <span className="text-sm font-medium text-slate-900">
                        {entry.firstName} {entry.lastName}
                      </span>
                      {entry.premiumShifts > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] font-semibold text-amber-600">
                          <Star size={11} className="fill-amber-400 stroke-amber-500" />
                          {entry.premiumShifts} premium
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-700">{entry.totalHours}h</span>
                      {entry.desiredWeeklyHours != null && (
                        <span className="text-xs text-slate-400">/ {entry.desiredWeeklyHours}h desired</span>
                      )}
                      {entry.totalHours > 40 && <Badge variant="destructive" className="text-[10px]">Over 40h</Badge>}
                      {entry.totalHours >= 35 && entry.totalHours <= 40 && <Badge variant="warning" className="text-[10px]">35h+</Badge>}
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min((entry.totalHours / maxHours) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Overtime summary */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Overtime Risk</CardTitle>
          <CardDescription>
            {locationId
              ? `Staff scheduled at ${locationsQuery.data?.find((l) => l.id === locationId)?.name ?? locationId} for week of ${week}.`
              : "Select a location to see overtime risk breakdown."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!locationId ? (
            <p className="text-sm text-slate-400 py-2">Choose a location above to load overtime data.</p>
          ) : overtimeQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-slate-400">
              <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
              <span className="text-sm">Loading overtime data…</span>
            </div>
          ) : overtimeData.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">No assignments found for this week.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Staff</th>
                  <th className="py-2.5 pr-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Hrs</th>
                  <th className="py-2.5 pr-2 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Desired</th>
                  <th className="py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider pl-3">Risk</th>
                </tr>
              </thead>
              <tbody>
                {overtimeData.map((entry) => (
                  <tr key={entry.userId} className="border-b border-slate-50">
                    <td className="py-2.5">
                      <span className="font-medium text-slate-900">{entry.firstName} {entry.lastName}</span>
                    </td>
                    <td className="py-2.5 pr-2 text-right tabular-nums">
                      <span className={cn(
                        "font-semibold",
                        entry.overtimeRisk === "OVER_LIMIT" || entry.overtimeRisk === "AT_LIMIT"
                          ? "text-red-600"
                          : entry.overtimeRisk === "WARNING"
                            ? "text-amber-600"
                            : "text-slate-700",
                      )}>
                        {entry.weeklyHours}h
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 text-right tabular-nums text-slate-400">
                      {entry.desiredWeeklyHours != null ? `${entry.desiredWeeklyHours}h` : "—"}
                    </td>
                    <td className="py-2.5 pl-3">
                      <OvertimeRiskBadge risk={entry.overtimeRisk} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {overtimeData.some((e) => e.overtimeRisk !== "LOW") && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
              <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-700">
                One or more staff members are approaching or exceeding overtime thresholds. Review assignments before publishing.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
