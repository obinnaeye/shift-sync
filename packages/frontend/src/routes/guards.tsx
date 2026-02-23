import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";

function SessionRestoring() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-500">
        <div className="h-5 w-5 rounded-full border-2 border-slate-200 border-t-blue-500 animate-spin" />
        <span className="text-sm font-medium">Restoring session…</span>
      </div>
    </div>
  );
}

export function PrivateRoute() {
  const user = useAuthStore((s) => s.currentUser);
  const isBootstrapped = useAuthStore((s) => s.isBootstrapped);
  if (!isBootstrapped) return <SessionRestoring />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function ManagerRoute() {
  const user = useAuthStore((s) => s.currentUser);
  const isBootstrapped = useAuthStore((s) => s.isBootstrapped);
  if (!isBootstrapped) return <SessionRestoring />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "ADMIN" && user.role !== "MANAGER") return <Navigate to="/schedule" replace />;
  return <Outlet />;
}

export function AdminRoute() {
  const user = useAuthStore((s) => s.currentUser);
  const isBootstrapped = useAuthStore((s) => s.isBootstrapped);
  if (!isBootstrapped) return <SessionRestoring />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "ADMIN") return <Navigate to="/schedule" replace />;
  return <Outlet />;
}
