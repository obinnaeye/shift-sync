import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, CalendarDays, MapPin } from "lucide-react";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "../stores/auth-store";
import { useNotificationStore } from "../stores/notification-store";
import { OnDutyBoard } from "../components/dashboard/on-duty-board";
import type { Location, NotificationPreference, OvertimeEntry } from "../types";
import { toWeekMondayIso } from "../utils/time";
import { cn } from "@/lib/utils";

const roleConfig = {
  ADMIN: { label: "Administrator", variant: "destructive" as const },
  MANAGER: { label: "Manager", variant: "warning" as const },
  STAFF: { label: "Staff", variant: "secondary" as const },
};

function NotificationPrefsCard({ userId }: { userId: string }) {
  const [saving, setSaving] = useState(false);
  const prefsQuery = useQuery({
    queryKey: ["notif-prefs", userId],
    queryFn: async () => {
      const res = await api.get<{ preferences: NotificationPreference }>("/users/me/notification-preferences");
      return res.data.preferences;
    },
  });

  async function toggle(field: "inApp" | "email") {
    if (!prefsQuery.data) return;
    setSaving(true);
    try {
      await api.put("/users/me/notification-preferences", {
        inApp: field === "inApp" ? !prefsQuery.data.inApp : prefsQuery.data.inApp,
        email: field === "email" ? !prefsQuery.data.email : prefsQuery.data.email,
      });
      prefsQuery.refetch();
    } finally {
      setSaving(false);
    }
  }

  const prefs = prefsQuery.data;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Bell size={15} className="text-slate-500" />
          <CardTitle className="text-sm">Notification Preferences</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-slate-700">In-app notifications</span>
          <input
            type="checkbox"
            checked={prefs?.inApp ?? true}
            disabled={saving}
            onChange={() => toggle("inApp")}
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-slate-700">Email simulation</span>
          <input
            type="checkbox"
            checked={prefs?.email ?? false}
            disabled={saving}
            onChange={() => toggle("email")}
          />
        </label>
      </CardContent>
    </Card>
  );
}

function OvertimeWidget() {
  const [locationId, setLocationId] = useState("");
  const week = toWeekMondayIso();

  const locationsQuery = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const res = await api.get<{ locations: Location[] }>("/locations");
      return res.data.locations;
    },
  });

  const overtimeQuery = useQuery({
    queryKey: ["overtime-dash", locationId, week],
    enabled: Boolean(locationId),
    queryFn: async () => {
      const res = await api.get<{ summary: OvertimeEntry[] }>("/analytics/overtime", {
        params: { locationId, week },
      });
      return res.data.summary;
    },
  });

  const atRisk = useMemo(
    () => (overtimeQuery.data ?? []).filter((e) => e.overtimeRisk !== "LOW"),
    [overtimeQuery.data],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <CardTitle>Overtime Risk — This Week</CardTitle>
          </div>
          <select
            className="text-xs h-7 rounded border border-slate-200 px-2 text-slate-600"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Select location…</option>
            {(locationsQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <CardDescription>
          {atRisk.length > 0
            ? `${atRisk.length} staff member${atRisk.length === 1 ? "" : "s"} at or approaching overtime.`
            : locationId ? "No overtime risk this week." : "Choose a location to check overtime."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!locationId ? null : overtimeQuery.isLoading ? (
          <div className="flex items-center gap-2 text-slate-400">
            <div className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : atRisk.length === 0 ? (
          <p className="text-sm text-green-600 font-medium">✓ All staff within safe limits</p>
        ) : (
          <ul className="space-y-2">
            {atRisk.map((entry) => (
              <li key={entry.userId} className="flex items-center justify-between">
                <span className="text-sm text-slate-900">
                  {entry.firstName} {entry.lastName}
                </span>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm font-semibold tabular-nums",
                    entry.overtimeRisk === "OVER_LIMIT" || entry.overtimeRisk === "AT_LIMIT"
                      ? "text-red-600"
                      : "text-amber-600",
                  )}>
                    {entry.weeklyHours}h
                  </span>
                  {entry.overtimeRisk === "OVER_LIMIT" && <Badge variant="destructive" className="text-[10px]">Over</Badge>}
                  {entry.overtimeRisk === "AT_LIMIT" && <Badge variant="destructive" className="text-[10px]">Limit</Badge>}
                  {entry.overtimeRisk === "WARNING" && <Badge variant="warning" className="text-[10px]">Warning</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.currentUser);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";
  const config = user?.role ? roleConfig[user.role] : null;

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-slate-400 text-sm mb-1">Good to see you back,</p>
            <h1 className="text-xl font-bold">
              {user?.firstName} {user?.lastName}
            </h1>
          </div>
          {config && (
            <Badge variant={config.variant} className="mt-0.5 text-xs uppercase tracking-wider">
              {config.label}
            </Badge>
          )}
        </div>
      </div>

      {/* Quick-glance stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wider">Platform</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
                <CalendarDays size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">ShiftSync</p>
                <p className="text-xs text-slate-400">Multi-location scheduling</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wider">Locations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100">
                <MapPin size={18} className="text-green-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">4 Locations</p>
                <p className="text-xs text-slate-400">2 timezones covered</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500 uppercase tracking-wider">Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
                <Bell size={18} className="text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
                </p>
                <p className="text-xs text-slate-400">Real-time via socket</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manager features */}
      {isManager && (
        <div className="grid gap-4 lg:grid-cols-2">
          <OvertimeWidget />
          <NotificationPrefsCard userId={user!.id} />
        </div>
      )}

      {/* Staff notification prefs + on-duty board */}
      {!isManager && user && (
        <div className="max-w-sm">
          <NotificationPrefsCard userId={user.id} />
        </div>
      )}

      {isManager && <OnDutyBoard />}
    </div>
  );
}
