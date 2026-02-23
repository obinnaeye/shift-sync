import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { api } from "../lib/api";
import type { AuditLog, Location } from "../types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const actionVariant: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
  CREATE: "success",
  UPDATE: "default",
  DELETE: "destructive",
  PUBLISH: "success",
  CANCEL: "warning",
  ASSIGN: "default",
  UNASSIGN: "warning",
};

function LogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);
  const timeLabel = formatInTimeZone(new Date(log.createdAt), "UTC", "MMM d, yyyy HH:mm:ss 'UTC'");

  return (
    <>
      <tr
        className="border-b border-slate-50 hover:bg-slate-50/50 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-3 pl-4 w-6">
          {expanded
            ? <ChevronDown size={13} className="text-slate-400" />
            : <ChevronRight size={13} className="text-slate-400" />}
        </td>
        <td className="py-3 pr-4 text-xs text-slate-400 whitespace-nowrap">{timeLabel}</td>
        <td className="py-3 pr-4">
          <span className="text-sm font-medium text-slate-900">
            {log.actor.firstName} {log.actor.lastName}
          </span>
        </td>
        <td className="py-3 pr-4">
          <Badge variant={actionVariant[log.action] ?? "secondary"} className="text-[10px]">
            {log.action}
          </Badge>
        </td>
        <td className="py-3 pr-4 text-sm text-slate-600">{log.entityType}</td>
        <td className="py-3 pr-4 text-sm text-slate-500">
          {log.shift ? (
            <span>
              {log.shift.location.name} — {formatInTimeZone(new Date(log.shift.startTime), "UTC", "MMM d HH:mm")}
            </span>
          ) : (
            <code className="text-xs">{log.entityId.slice(0, 8)}…</code>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/60">
          <td colSpan={6} className="px-8 py-3">
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              {log.reason && (
                <div>
                  <p className="font-semibold text-slate-500 mb-1">Reason</p>
                  <p className="text-slate-700">{log.reason}</p>
                </div>
              )}
              {log.before != null && (
                <div>
                  <p className="font-semibold text-slate-500 mb-1">Before</p>
                  <pre className="bg-white border border-slate-100 rounded p-2 overflow-auto max-h-32 text-[11px] text-slate-600">
                    {JSON.stringify(log.before as Record<string, unknown>, null, 2)}
                  </pre>
                </div>
              )}
              {log.after != null && (
                <div>
                  <p className="font-semibold text-slate-500 mb-1">After</p>
                  <pre className="bg-white border border-slate-100 rounded p-2 overflow-auto max-h-32 text-[11px] text-slate-600">
                    {JSON.stringify(log.after as Record<string, unknown>, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditPage() {
  const [locationId, setLocationId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const response = await api.get<{ locations: Location[] }>("/locations");
      return response.data.locations;
    },
  });

  const logsQuery = useQuery({
    queryKey: ["audit-logs", locationId, dateFrom, dateTo, entityType, page],
    queryFn: async () => {
      const response = await api.get<{ logs: AuditLog[]; total: number; limit: number }>("/audit-logs", {
        params: {
          ...(locationId ? { locationId } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo: new Date(new Date(dateTo).getTime() + 86400000).toISOString() } : {}),
          ...(entityType ? { entityType } : {}),
          page,
          limit: 50,
        },
      });
      return response.data;
    },
  });

  const logs = logsQuery.data?.logs ?? [];
  const total = logsQuery.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
          <History size={18} className="text-slate-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500">
            Full history of all schedule changes — who made them, when, and what changed.
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Location</Label>
              <select value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(1); }}>
                <option value="">All locations</option>
                {(locationsQuery.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Entity type</Label>
              <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
                <option value="">All types</option>
                <option value="Shift">Shift</option>
                <option value="ShiftAssignment">Assignment</option>
                <option value="SwapRequest">Swap Request</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>From date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>To date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Audit Events</CardTitle>
            <CardDescription>{total} total events</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {logsQuery.isLoading ? (
            <div className="flex items-center gap-2 px-6 py-8 text-slate-400">
              <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
              <span className="text-sm">Loading audit logs…</span>
            </div>
          ) : logs.length === 0 ? (
            <p className="text-sm text-slate-400 px-6 py-8">No audit events found for the selected filters.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="w-6 py-2.5 pl-4" />
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Time (UTC)</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Actor</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Entity</th>
                  <th className="py-2.5 pr-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Shift/ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => <LogRow key={log.id} log={log} />)}
              </tbody>
            </table>
          )}
        </CardContent>
        {total > 50 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
            <p className="text-sm text-slate-500">Page {page} of {Math.ceil(total / 50)}</p>
            <div className="flex gap-2">
              <Button
                size="sm" variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm" variant="outline"
                disabled={page >= Math.ceil(total / 50)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
