import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, CheckCircle, RefreshCw, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAuthStore } from "../stores/auth-store";
import type { Assignment, Shift, SwapRequest, SwapType } from "../types";
import { formatShiftRange } from "../utils/time";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type AssignmentWithShift = Assignment & { shift: Shift };

function statusBadge(status: string) {
  switch (status) {
    case "APPROVED":
    case "CONFIRMED":
      return <Badge variant="success">{status}</Badge>;
    case "REJECTED":
    case "CANCELLED":
    case "EXPIRED":
    case "DROPPED":
      return <Badge variant="destructive">{status}</Badge>;
    case "PENDING_MANAGER":
    case "PENDING_ACCEPTANCE":
      return <Badge variant="warning">{status.replace("_", " ")}</Badge>;
    case "OPEN":
      return <Badge variant="default">OPEN</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {count !== undefined && (
        <span
          className={cn(
            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold",
            count > 0 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400",
          )}
        >
          {count}
        </span>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="text-sm text-slate-400 py-3 text-center">{text}</p>
  );
}

export function SwapRequestsPage() {
  const user = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isStaff = user?.role === "STAFF";

  const [createType, setCreateType] = useState<SwapType>("DROP");
  const [assignmentId, setAssignmentId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [managerNote, setManagerNote] = useState("");

  const swapRequestsQuery = useQuery({
    queryKey: ["swap-requests"],
    queryFn: async () => {
      const response = await api.get<{ swapRequests: SwapRequest[] }>("/swap-requests");
      return response.data.swapRequests;
    },
  });

  const myAssignmentsQuery = useQuery({
    queryKey: ["swap-my-assignments"],
    enabled: isStaff,
    queryFn: async () => {
      const response = await api.get<{ assignments: AssignmentWithShift[] }>(
        "/swap-requests/my-assignments",
      );
      return response.data.assignments;
    },
  });

  const availableDropsQuery = useQuery({
    queryKey: ["swap-drop-available"],
    enabled: isStaff,
    queryFn: async () => {
      const response = await api.get<{ swapRequests: SwapRequest[] }>("/swap-requests/drop-available");
      return response.data.swapRequests;
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
    queryClient.invalidateQueries({ queryKey: ["swap-my-assignments"] });
    queryClient.invalidateQueries({ queryKey: ["swap-drop-available"] });
    queryClient.invalidateQueries({ queryKey: ["shifts"] });
    queryClient.invalidateQueries({ queryKey: ["on-duty"] });
  };

  const createMutation = useMutation({
    mutationFn: async () =>
      api.post("/swap-requests", {
        type: createType,
        assignmentId,
        targetId: createType === "SWAP" ? targetId : null,
      }),
    onSuccess: () => {
      setTargetId("");
      refreshAll();
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (opts: { path: string; body?: Record<string, unknown> }) =>
      api.post(opts.path, opts.body ?? {}),
    onSuccess: () => refreshAll(),
  });

  const myRequests = useMemo(
    () => (swapRequestsQuery.data ?? []).filter((r) => r.requesterId === user?.id),
    [swapRequestsQuery.data, user?.id],
  );
  const incomingSwaps = useMemo(
    () =>
      (swapRequestsQuery.data ?? []).filter(
        (r) =>
          r.type === "SWAP" && r.targetId === user?.id && r.status === "PENDING_ACCEPTANCE",
      ),
    [swapRequestsQuery.data, user?.id],
  );
  const pendingManager = useMemo(
    () => (swapRequestsQuery.data ?? []).filter((r) => r.status === "PENDING_MANAGER"),
    [swapRequestsQuery.data],
  );

  const isBusy = createMutation.isPending || actionMutation.isPending;
  const availableDrops = availableDropsQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
          <ArrowLeftRight size={18} className="text-purple-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Swap & Drop Requests</h1>
          <p className="text-sm text-slate-500">
            Manage shift exchanges and dropped-shift pickups.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Create request (staff) */}
        {isStaff && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <RefreshCw size={15} className="text-slate-500" />
                <CardTitle>Create Request</CardTitle>
              </div>
              <CardDescription>
                Submit a swap or drop request for one of your assignments.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>My assignment</Label>
                <select
                  value={assignmentId}
                  onChange={(e) => setAssignmentId(e.target.value)}
                >
                  <option value="">Select assignment…</option>
                  {(myAssignmentsQuery.data ?? []).map((a) => {
                    const tz = a.shift?.location?.timezone ?? "UTC";
                    return (
                      <option key={a.id} value={a.id}>
                        {a.shift?.location?.name ?? a.shift?.locationId} —{" "}
                        {formatShiftRange(a.shift.startTime, a.shift.endTime, tz)}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Request type</Label>
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value as SwapType)}
                >
                  <option value="DROP">Drop (open for anyone to pick up)</option>
                  <option value="SWAP">Swap (with a specific colleague)</option>
                </select>
              </div>

              {createType === "SWAP" && (
                <div className="space-y-1.5">
                  <Label>Target staff user ID</Label>
                  <Input
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="font-mono text-xs"
                  />
                </div>
              )}

              <Button
                onClick={() => createMutation.mutate()}
                disabled={!assignmentId || (createType === "SWAP" && !targetId) || isBusy}
                className="w-full"
              >
                {createMutation.isPending ? "Creating…" : "Submit Request"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Incoming swaps (staff) */}
        {isStaff && (
          <Card>
            <CardHeader>
              <CardTitle>Incoming Swap Requests</CardTitle>
              <CardDescription>
                Colleagues who want to swap their shift with yours.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SectionHeader title="Awaiting your response" count={incomingSwaps.length} />
              {incomingSwaps.length === 0 ? (
                <EmptyState text="No incoming swaps right now." />
              ) : (
                <ul className="space-y-2">
                  {incomingSwaps.map((req) => (
                    <li
                      key={req.id}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <code className="text-[11px] text-slate-400">{req.id.slice(0, 8)}…</code>
                        {statusBadge(req.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="success"
                          disabled={isBusy}
                          onClick={() =>
                            actionMutation.mutate({ path: `/swap-requests/${req.id}/accept` })
                          }
                        >
                          <CheckCircle size={13} /> Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() =>
                            actionMutation.mutate({ path: `/swap-requests/${req.id}/reject` })
                          }
                        >
                          <XCircle size={13} className="text-red-500" /> Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* Available drops (staff) */}
        {isStaff && (
          <Card>
            <CardHeader>
              <CardTitle>Available Drops</CardTitle>
              <CardDescription>
                Open shifts from colleagues who've dropped theirs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SectionHeader title="Pick up a shift" count={availableDrops.length} />
              {availableDrops.length === 0 ? (
                <EmptyState text="No open drops available." />
              ) : (
                <ul className="space-y-2">
                  {availableDrops.map((req) => (
                    <li
                      key={req.id}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                    >
                      <p className="text-sm font-medium text-slate-900 mb-1">
                        {req.assignment?.shift?.location?.name ?? req.assignment?.shift?.locationId ?? "Unknown location"}
                      </p>
                      <p className="text-xs text-slate-500 mb-2">
                        {req.assignment?.shift
                          ? formatShiftRange(
                              req.assignment.shift.startTime,
                              req.assignment.shift.endTime,
                              req.assignment.shift.location?.timezone ?? "UTC",
                            )
                          : req.assignmentId}
                      </p>
                      <Button
                        size="sm"
                        disabled={isBusy}
                        onClick={() =>
                          actionMutation.mutate({ path: `/swap-requests/${req.id}/pickup` })
                        }
                      >
                        Pick Up Shift
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {/* My requests */}
        <Card>
          <CardHeader>
            <CardTitle>My Requests</CardTitle>
            <CardDescription>History of swap and drop requests you've submitted.</CardDescription>
          </CardHeader>
          <CardContent>
            <SectionHeader title="All requests" count={myRequests.length} />
            {myRequests.length === 0 ? (
              <EmptyState text="No requests submitted yet." />
            ) : (
              <ul className="space-y-2">
                {myRequests.map((req) => (
                  <li
                    key={req.id}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline">{req.type}</Badge>
                        <code className="text-[11px] text-slate-400">{req.id.slice(0, 8)}…</code>
                      </div>
                      {statusBadge(req.status)}
                    </div>
                    {(req.status === "PENDING_ACCEPTANCE" ||
                      req.status === "OPEN" ||
                      req.status === "PENDING_MANAGER") && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          actionMutation.mutate({ path: `/swap-requests/${req.id}/cancel` })
                        }
                        className="mt-1.5 text-red-600 border-red-200 hover:bg-red-50"
                      >
                        <XCircle size={13} /> Cancel
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Pending manager approvals */}
        {isManager && (
          <Card>
            <CardHeader>
              <CardTitle>Pending Approvals</CardTitle>
              <CardDescription>Swap/drop requests awaiting your decision.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Decision note (optional)</Label>
                <Input
                  value={managerNote}
                  onChange={(e) => setManagerNote(e.target.value)}
                  placeholder="Add a note for staff…"
                />
              </div>
              <SectionHeader title="Awaiting decision" count={pendingManager.length} />
              {pendingManager.length === 0 ? (
                <EmptyState text="No pending approvals." />
              ) : (
                <ul className="space-y-2">
                  {pendingManager.map((req) => (
                    <li
                      key={req.id}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline">{req.type}</Badge>
                          <code className="text-[11px] text-slate-400">{req.id.slice(0, 8)}…</code>
                        </div>
                        {statusBadge(req.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="success"
                          disabled={isBusy}
                          onClick={() =>
                            actionMutation.mutate({
                              path: `/swap-requests/${req.id}/approve`,
                              body: { managerNote: managerNote || undefined },
                            })
                          }
                        >
                          <CheckCircle size={13} /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isBusy}
                          onClick={() =>
                            actionMutation.mutate({
                              path: `/swap-requests/${req.id}/reject-manager`,
                              body: { managerNote: managerNote || undefined },
                            })
                          }
                          className="text-red-600 border-red-200 hover:bg-red-50"
                        >
                          <XCircle size={13} /> Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
