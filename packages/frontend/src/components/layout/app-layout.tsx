import { useEffect, useState } from "react";
import { BarChart3, Bell, CalendarDays, Clock, History, LayoutDashboard, LogOut, RefreshCw, Users, X } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSocketEvents } from "../../hooks/use-socket-events";
import { api } from "../../lib/api";
import { cn } from "@/lib/utils";
import { useAuthStore } from "../../stores/auth-store";
import { useNotificationStore } from "../../stores/notification-store";
import { useSocketStore } from "../../stores/socket-store";

const staffNavItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/swap-requests", label: "Swaps", icon: RefreshCw },
  { to: "/availability", label: "Availability", icon: Clock },
];

const managerNavItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
  { to: "/swap-requests", label: "Swaps", icon: RefreshCw },
  { to: "/users", label: "Users", icon: Users },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/audit", label: "Audit", icon: History },
];

export function AppLayout() {
  useSocketEvents();
  const [showNotifications, setShowNotifications] = useState(false);
  const user = useAuthStore((s) => s.currentUser);
  const accessToken = useAuthStore((s) => s.accessToken);
  const csrfToken = useAuthStore((s) => s.csrfToken);
  const logout = useAuthStore((s) => s.logout);
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const recentNotifications = useNotificationStore((s) => s.recent);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const navigate = useNavigate();

  useEffect(() => {
    if (user && accessToken) {
      connect(accessToken);
      return;
    }
    disconnect();
  }, [user, accessToken, connect, disconnect]);

  async function onLogout() {
    try {
      await api.post("/auth/logout", {}, { headers: { "X-CSRF-Token": csrfToken ?? "" } });
    } catch {
      // best-effort
    } finally {
      logout();
      navigate("/login");
    }
  }

  const initials = user
    ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase()
    : "?";

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Topbar */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-900">
        <div className="flex h-14 items-center gap-2 px-4 md:px-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5 shrink-0 mr-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white text-sm font-bold select-none">
              SS
            </div>
            <div className="hidden md:block">
              <div className="text-sm font-semibold text-white leading-none">ShiftSync</div>
              <div className="text-xs text-slate-400 leading-none mt-0.5">Coastal Eats</div>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-700 mx-1 hidden md:block" />

          {/* Nav */}
          <nav className="flex items-center gap-0.5">
            {(user?.role === "ADMIN" || user?.role === "MANAGER" ? managerNavItems : staffNavItems).map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-slate-700 text-white"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white",
                  )
                }
              >
                <Icon size={15} />
                <span className="hidden sm:block">{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="flex-1" />

          {/* Right side */}
          <div className="flex items-center gap-1.5">
            {/* Notification bell */}
            <button
              onClick={() => setShowNotifications((v) => !v)}
              className="relative flex items-center justify-center h-8 w-8 rounded-md text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              aria-label="Notifications"
            >
              <Bell size={17} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* User pill */}
            <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-2.5 py-1.5 ml-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-semibold select-none">
                {initials}
              </div>
              <div className="hidden md:flex flex-col leading-none">
                <span className="text-xs font-medium text-slate-100">
                  {user?.firstName} {user?.lastName}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">
                  {user?.role}
                </span>
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={onLogout}
              className="flex items-center justify-center h-8 w-8 rounded-md text-slate-400 hover:bg-red-900/50 hover:text-red-400 transition-colors ml-0.5"
              aria-label="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Notification panel */}
      {showNotifications && (
        <div className="fixed top-14 right-4 z-50 w-80 md:w-96">
          <div className="rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
                {unreadCount > 0 && (
                  <p className="text-xs text-slate-500 mt-0.5">{unreadCount} unread</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setShowNotifications(false)}
                  className="flex items-center justify-center h-7 w-7 rounded-md text-slate-400 hover:bg-slate-100 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {recentNotifications.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Bell size={24} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm text-slate-400">No notifications yet</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-50">
                  {recentNotifications.map((n) => (
                    <li key={n.id} className={cn("px-4 py-3", !n.isRead && "bg-blue-50/50")}>
                      <div className="flex items-start gap-2">
                        {!n.isRead && (
                          <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                        )}
                        <div className={!n.isRead ? "" : "ml-3.5"}>
                          <p className="text-sm font-medium text-slate-900">{n.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.body}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
