import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { Users } from "lucide-react";
import { api } from "../../lib/api";
import { formatShiftRange } from "../../utils/time";
import { useSocketStore } from "../../stores/socket-store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { Location, OnDutyEntry } from "../../types";

type OnDutyResponse = {
  locationId: string;
  asOf: string;
  onDuty: OnDutyEntry[];
};

export function OnDutyBoard() {
  const [locationId, setLocationId] = useState("");
  const joinRooms = useSocketStore((s) => s.joinRooms);

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const response = await api.get<{ locations: Location[] }>("/locations");
      return response.data.locations;
    },
  });

  useEffect(() => {
    if (!locationId && locationsQuery.data && locationsQuery.data.length > 0) {
      setLocationId(locationsQuery.data[0].id);
    }
  }, [locationId, locationsQuery.data]);

  useEffect(() => {
    if (!locationId) return;
    joinRooms([locationId]);
  }, [joinRooms, locationId]);

  const onDutyQuery = useQuery({
    queryKey: ["on-duty", locationId],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const response = await api.get<OnDutyResponse>(`/locations/${locationId}/on-duty`);
      return response.data;
    },
  });

  const locationTimezone = useMemo(
    () => locationsQuery.data?.find((l) => l.id === locationId)?.timezone ?? "UTC",
    [locationsQuery.data, locationId],
  );

  const asOfLabel = useMemo(() => {
    const asOf = onDutyQuery.data?.asOf;
    if (!asOf) return "n/a";
    return formatInTimeZone(new Date(asOf), locationTimezone, "MMM d, h:mm a zzz");
  }, [locationTimezone, onDutyQuery.data?.asOf]);

  const onDuty = onDutyQuery.data?.onDuty ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100">
              <Users size={16} className="text-green-600" />
            </div>
            <div>
              <CardTitle>On-Duty Now</CardTitle>
              <CardDescription className="mt-0.5">
                As of {asOfLabel}
              </CardDescription>
            </div>
          </div>

          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="max-w-[200px]"
          >
            {(locationsQuery.data ?? []).map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {onDutyQuery.isLoading ? (
          <div className="flex items-center gap-2 text-slate-400 py-4">
            <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
            <span className="text-sm">Loading staff…</span>
          </div>
        ) : onDutyQuery.isError ? (
          <p className="text-sm text-red-500 py-2">Failed to load on-duty board.</p>
        ) : onDuty.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Users size={32} className="text-slate-200" />
            <p className="text-sm text-slate-400">No one is currently on duty.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {onDuty.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-xs font-semibold select-none">
                    {entry.user.firstName[0]}{entry.user.lastName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {entry.user.firstName} {entry.user.lastName}
                    </p>
                    <p className="text-xs text-slate-400">{entry.user.email}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-500 tabular-nums">
                  {formatShiftRange(entry.shiftStartTime, entry.shiftEndTime, locationTimezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
