import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/app-layout";
import { api } from "./lib/api";
import { DashboardPage } from "./pages/dashboard-page";
import { LoginPage } from "./pages/login-page";
import { NotFoundPage } from "./pages/not-found-page";
import { SchedulePage } from "./pages/schedule-page";
import { ShiftDetailPage } from "./pages/shift-detail-page";
import { SwapRequestsPage } from "./pages/swap-requests-page";
import { AnalyticsPage } from "./pages/analytics-page";
import { AuditPage } from "./pages/audit-page";
import { UsersPage } from "./pages/users-page";
import { AvailabilityPage } from "./pages/availability-page";
import { ManagerRoute, PrivateRoute } from "./routes/guards";
import { useAuthStore } from "./stores/auth-store";
import type { User } from "./types";

function AuthBootstrapper() {
  const didBootstrap = useRef(false);

  useEffect(() => {
    if (didBootstrap.current) return;
    didBootstrap.current = true;

    async function bootstrapAuth() {
      const initialCsrfToken = useAuthStore.getState().csrfToken;

      if (!initialCsrfToken) {
        useAuthStore.getState().markBootstrapped();
        return;
      }

      try {
        const refreshResponse = await api.post<{ accessToken: string; csrfToken: string }>(
          "/auth/refresh",
          {},
          { headers: { "X-CSRF-Token": initialCsrfToken } },
        );

        useAuthStore.getState().setAccessToken(refreshResponse.data.accessToken);
        useAuthStore.getState().setCsrfToken(refreshResponse.data.csrfToken);

        const meResponse = await api.get<{ user: User }>("/auth/me", {
          headers: { "Cache-Control": "no-store" },
        });
        useAuthStore.getState().setCurrentUser(meResponse.data.user);
      } catch {
        useAuthStore.getState().logout();
      } finally {
        useAuthStore.getState().markBootstrapped();
      }
    }

    void bootstrapAuth();
  }, []);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthBootstrapper />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<PrivateRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/swap-requests" element={<SwapRequestsPage />} />
            <Route path="/shifts/:id" element={<ShiftDetailPage />} />
            <Route path="/availability" element={<AvailabilityPage />} />
            <Route element={<ManagerRoute />}>
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/audit" element={<AuditPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
