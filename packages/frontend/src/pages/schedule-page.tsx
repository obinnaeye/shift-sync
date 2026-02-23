import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Info, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import type { Location, Shift, Skill } from "../types";
import { ScheduleCalendar } from "../components/schedule/schedule-calendar";
import { useSocketStore } from "../stores/socket-store";
import { useAuthStore } from "../stores/auth-store";
import { toWeekMondayIso } from "../utils/time";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function CreateShiftModal({
  locations,
  skills,
  onClose,
}: {
  locations: Location[];
  skills: Skill[];
  onClose: () => void;
}) {
  const user = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [headcount, setHeadcount] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      api.post("/shifts", { locationId, skillId, startTime, endTime, headcount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? "Failed to create shift.");
    },
  });

  if (!user || (user.role !== "ADMIN" && user.role !== "MANAGER")) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Create New Shift</h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-7 w-7 rounded-md text-slate-400 hover:bg-slate-100 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Location</Label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Required Skill</Label>
            <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
              {skills.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start time</Label>
              <Input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End time</Label>
              <Input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Headcount needed</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={headcount}
              onChange={(e) => setHeadcount(Number(e.target.value))}
            />
          </div>
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!locationId || !skillId || !startTime || !endTime || mutation.isPending}
          >
            {mutation.isPending ? "Creating…" : "Create Shift"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SchedulePage() {
  const [params, setParams] = useSearchParams();
  const week = params.get("week") ?? toWeekMondayIso();
  const locationId = params.get("locationId") ?? "";
  const joinRooms = useSocketStore((s) => s.joinRooms);
  const user = useAuthStore((s) => s.currentUser);
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";
  const [showCreate, setShowCreate] = useState(false);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const response = await api.get<{ locations: Location[] }>("/locations");
      return response.data.locations;
    },
  });

  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const response = await api.get<{ skills: Skill[] }>("/skills");
      return response.data.skills;
    },
    enabled: isManager,
  });

  const shiftsQuery = useQuery({
    queryKey: ["shifts", locationId, week],
    queryFn: async () => {
      const response = await api.get<{ shifts: Shift[] }>("/shifts", {
        params: { week, ...(locationId ? { locationId } : {}) },
      });
      return response.data.shifts;
    },
  });

  const timezone = useMemo(() => {
    if (!locationId) return "UTC";
    return (
      locationsQuery.data?.find((l) => l.id === locationId)?.timezone ??
      shiftsQuery.data?.[0]?.location?.timezone ??
      "UTC"
    );
  }, [locationId, locationsQuery.data, shiftsQuery.data]);

  useEffect(() => {
    if (!locationId) return;
    joinRooms([locationId]);
  }, [locationId, joinRooms]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
            <CalendarDays size={18} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Schedule Calendar</h1>
            <p className="text-sm text-slate-500">Review and manage weekly schedules by location.</p>
          </div>
        </div>
        {isManager && (
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus size={15} />
            Create Shift
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Location</Label>
              {locationsQuery.data && locationsQuery.data.length > 0 ? (
                <select
                  value={locationId}
                  onChange={(e) => setParams({ week, locationId: e.target.value })}
                >
                  <option value="">All locations</option>
                  {locationsQuery.data.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  value={locationId}
                  onChange={(e) => setParams({ week, locationId: e.target.value })}
                  placeholder="Location UUID"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Week starting (Monday)</Label>
              <Input
                type="date"
                value={week}
                onChange={(e) =>
                  setParams({ week: e.target.value, ...(locationId ? { locationId } : {}) })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {!locationId && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Info size={15} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            Select a location to render the calendar in that location's timezone.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {locationId
              ? (locationsQuery.data?.find((l) => l.id === locationId)?.name ?? "Location")
              : "All Locations"}
          </CardTitle>
          {locationId && timezone !== "UTC" && (
            <CardDescription>Displaying times in {timezone}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {shiftsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
              <div className="h-5 w-5 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
              <span className="text-sm">Loading schedule…</span>
            </div>
          ) : shiftsQuery.isError ? (
            <p className="text-sm text-red-500 py-4">Failed to load schedule.</p>
          ) : (
            <ScheduleCalendar shifts={shiftsQuery.data ?? []} timezone={timezone} />
          )}
        </CardContent>
      </Card>

      {showCreate && (
        <CreateShiftModal
          locations={locationsQuery.data ?? []}
          skills={skillsQuery.data ?? []}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
