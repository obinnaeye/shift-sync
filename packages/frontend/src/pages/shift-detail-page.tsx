import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { AxiosError } from "axios";
import { Clock, MapPin, Users, Zap } from "lucide-react";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth-store";
import type {
  Assignment,
  ConstraintErrorPayload,
  ConstraintSuggestion,
  ConstraintViolation,
  Shift,
} from "../types";
import { formatShiftRange } from "../utils/time";
import { ConstraintFeedback } from "../components/constraints/constraint-feedback";
import { WhatIfPanel } from "../components/analytics/what-if-panel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const statusVariant: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  PUBLISHED: "success",
  DRAFT: "secondary",
  CANCELLED: "destructive",
};

export function ShiftDetailPage() {
  const { id = "" } = useParams();
  const user = useAuthStore((s) => s.currentUser);
  const canManageAssignments = user?.role === "ADMIN" || user?.role === "MANAGER";
  const queryClient = useQueryClient();
  const [candidateStaffId, setCandidateStaffId] = useState("");
  const [violations, setViolations] = useState<ConstraintViolation[]>([]);
  const [suggestions, setSuggestions] = useState<ConstraintSuggestion[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [forceOverride, setForceOverride] = useState(false);

  const shiftQuery = useQuery({
    queryKey: ["shift", id],
    queryFn: async () => {
      const response = await api.get<{ shift: Shift }>(`/shifts/${id}`);
      return response.data.shift;
    },
    enabled: Boolean(id),
  });

  const assignmentsQuery = useQuery({
    queryKey: ["shift-assignments", id],
    queryFn: async () => {
      const response = await api.get<{ assignments: Assignment[] }>(`/shifts/${id}/assignments`);
      return response.data.assignments;
    },
    enabled: Boolean(id) && canManageAssignments,
  });

  const assignMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/shifts/${id}/assignments`, {
        userId: candidateStaffId,
        forceOverride,
        overrideReason: forceOverride ? overrideReason : undefined,
      });
    },
    onSuccess: () => {
      setViolations([]);
      setSuggestions([]);
      setCandidateStaffId("");
      setForceOverride(false);
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["shift-assignments", id] });
    },
    onError: (error) => {
      const axiosErr = error as AxiosError<ConstraintErrorPayload>;
      const data = axiosErr.response?.data;
      if (data?.error === "CONSTRAINT_VIOLATION") {
        setViolations(data.violations);
        setSuggestions(data.suggestions);
      }
    },
  });

  const timezone = shiftQuery.data?.location?.timezone ?? "UTC";
  const timeLabel = useMemo(() => {
    if (!shiftQuery.data) return "";
    return formatShiftRange(shiftQuery.data.startTime, shiftQuery.data.endTime, timezone);
  }, [shiftQuery.data, timezone]);

  const shift = shiftQuery.data;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Shift Detail</h1>
        <p className="text-sm text-slate-500">View shift information and manage staff assignments.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Shift info */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <CardTitle>Shift Information</CardTitle>
              {shift && (
                <Badge variant={statusVariant[shift.status] ?? "secondary"}>
                  {shift.status}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {shiftQuery.isLoading ? (
              <div className="flex items-center gap-2 text-slate-400 py-6">
                <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
                <span className="text-sm">Loading…</span>
              </div>
            ) : !shift ? (
              <p className="text-sm text-red-500">Could not load shift.</p>
            ) : (
              <dl className="space-y-4">
                <div className="flex items-start gap-3">
                  <Clock size={16} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Time</dt>
                    <dd className="text-sm font-medium text-slate-900 mt-0.5">{timeLabel}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin size={16} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Location</dt>
                    <dd className="text-sm font-medium text-slate-900 mt-0.5">
                      {shift.location?.name ?? shift.locationId}
                      <span className="ml-1.5 text-xs text-slate-400">({timezone})</span>
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users size={16} className="text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <dt className="text-xs font-medium text-slate-500 uppercase tracking-wider">Headcount</dt>
                    <dd className="text-sm font-medium text-slate-900 mt-0.5">{shift.headcount} staff required</dd>
                  </div>
                </div>
                {shift.isPremium && (
                  <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <Zap size={14} className="text-amber-600" />
                    <span className="text-sm font-medium text-amber-700">Premium shift</span>
                  </div>
                )}
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Assignment panel (managers only) */}
        {canManageAssignments && (
          <Card>
            <CardHeader>
              <CardTitle>Assign Staff</CardTitle>
              <CardDescription>Enter a staff member's user ID to assign them to this shift.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Staff User ID</Label>
                <Input
                  value={candidateStaffId}
                  onChange={(e) => setCandidateStaffId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="font-mono text-xs"
                />
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={forceOverride}
                  onChange={(e) => setForceOverride(e.target.checked)}
                  className="mt-0"
                />
                <span className="text-sm text-slate-700 group-hover:text-slate-900 transition-colors">
                  Force override (manager authority)
                </span>
              </label>

              {forceOverride && (
                <div className="space-y-1.5">
                  <Label>Override reason</Label>
                  <Input
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Document your reason for overriding constraints"
                  />
                </div>
              )}

              <Button
                onClick={() => assignMutation.mutate()}
                disabled={
                  !candidateStaffId ||
                  (forceOverride && !overrideReason) ||
                  assignMutation.isPending
                }
                className="w-full"
              >
                {assignMutation.isPending ? "Assigning…" : "Assign Staff"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* What-if panel */}
      {canManageAssignments && (
        <WhatIfPanel
          shiftId={id}
          staffId={candidateStaffId}
          enabled={candidateStaffId.trim().length === 36}
        />
      )}

      {/* Constraint feedback */}
      {violations.length > 0 && (
        <ConstraintFeedback violations={violations} suggestions={suggestions} />
      )}

      {/* Current assignments */}
      <Card>
        <CardHeader>
          <CardTitle>Current Assignments</CardTitle>
          <CardDescription>
            Staff currently confirmed for this shift.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {canManageAssignments ? (
            assignmentsQuery.isLoading ? (
              <p className="text-sm text-slate-400 py-2">Loading assignments…</p>
            ) : assignmentsQuery.isError ? (
              <p className="text-sm text-red-500 py-2">Could not load assignments.</p>
            ) : (assignmentsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 py-2">No staff assigned yet.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {(assignmentsQuery.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-semibold text-slate-600">
                        {a.user?.firstName?.[0]}{a.user?.lastName?.[0]}
                      </div>
                      <span className="text-sm text-slate-900">
                        {a.user ? `${a.user.firstName} ${a.user.lastName}` : <code className="text-xs">{a.userId}</code>}
                      </span>
                    </div>
                    <Badge variant={a.status === "CONFIRMED" ? "success" : a.status === "DROPPED" ? "destructive" : "secondary"}>
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )
          ) : (
            (shift?.assignments ?? []).length === 0 ? (
              <p className="text-sm text-slate-400 py-2">No confirmed assignments.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {(shift?.assignments ?? []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <code className="text-xs text-slate-600">{a.userId}</code>
                    <Badge variant="success">{a.status}</Badge>
                  </li>
                ))}
              </ul>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
