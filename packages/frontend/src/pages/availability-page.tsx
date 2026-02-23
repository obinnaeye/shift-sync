import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Save } from "lucide-react";
import { api } from "../lib/api";
import type { Availability } from "../types";
import { useAuthStore } from "../stores/auth-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

type AvailabilityRow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  enabled: boolean;
};

function buildRows(existing: Availability[]): AvailabilityRow[] {
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const found = existing.find((a) => a.dayOfWeek === day);
    return {
      dayOfWeek: day,
      startTime: found?.startTime ?? "09:00",
      endTime: found?.endTime ?? "17:00",
      timezone: found?.timezone ?? DEFAULT_TIMEZONE,
      enabled: !!found,
    };
  });
}

export function AvailabilityPage() {
  const user = useAuthStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<AvailabilityRow[] | null>(null);
  const [saved, setSaved] = useState(false);

  const availabilityQuery = useQuery({
    queryKey: ["my-availability", user?.id],
    queryFn: async () => {
      const response = await api.get<{ availability: Availability[] }>(`/users/${user!.id}/availability`);
      return response.data.availability;
    },
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (availabilityQuery.data && !rows) {
      setRows(buildRows(availabilityQuery.data));
    }
  }, [availabilityQuery.data, rows]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = (rows ?? [])
        .filter((r) => r.enabled)
        .map(({ dayOfWeek, startTime, endTime, timezone }) => ({ dayOfWeek, startTime, endTime, timezone }));
      return api.put(`/users/${user!.id}/availability`, { availability: payload });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-availability"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const displayRows = rows ?? buildRows(availabilityQuery.data ?? ([] as Availability[]));

  function updateRow(index: number, patch: Partial<AvailabilityRow>) {
    setRows((prev) => {
      const next = prev ?? buildRows(availabilityQuery.data ?? ([] as Availability[]));
      return next.map((r, i) => (i === index ? { ...r, ...patch } : r));
    });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100">
          <Clock size={18} className="text-green-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900">My Availability</h1>
          <p className="text-sm text-slate-500">
            Set the days and hours you're available to work each week.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weekly Availability</CardTitle>
          <CardDescription>
            Toggle each day on or off and set your available time window. Times apply in the timezone you select.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {displayRows.map((row, i) => (
            <div
              key={row.dayOfWeek}
              className="grid grid-cols-[120px_1fr] gap-3 items-center py-2 border-b border-slate-50 last:border-0"
            >
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                />
                <span className="text-sm font-medium text-slate-700">{DAY_NAMES[row.dayOfWeek]}</span>
              </label>

              {row.enabled ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">From</Label>
                    <Input
                      type="time"
                      value={row.startTime}
                      onChange={(e) => updateRow(i, { startTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">To</Label>
                    <Input
                      type="time"
                      value={row.endTime}
                      onChange={(e) => updateRow(i, { endTime: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400">Timezone</Label>
                    <Input
                      value={row.timezone}
                      onChange={(e) => updateRow(i, { timezone: e.target.value })}
                      className="text-xs"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-300 italic">Unavailable</p>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-3">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="gap-2"
            >
              <Save size={14} />
              {saveMutation.isPending ? "Saving…" : "Save Availability"}
            </Button>
            {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
          </div>
        </CardContent>
      </Card>

      <Card className="border-blue-100 bg-blue-50/30">
        <CardContent className="pt-4">
          <p className="text-sm text-blue-700">
            <strong>Timezone tip:</strong> Enter your availability in your local timezone (e.g., <code>America/Los_Angeles</code>). The system will check your availability window in that timezone when you are considered for shifts — even at locations in other timezones.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
