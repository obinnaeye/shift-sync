import { useState } from "react";
import type { FormEvent } from "react";
import { AxiosError } from "axios";
import { ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "../stores/auth-store";
import { useSocketStore } from "../stores/socket-store";
import type { User } from "../types";

export function LoginPage() {
  const [email, setEmail] = useState("admin@shiftsync.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const connectSocket = useSocketStore((s) => s.connect);
  const navigate = useNavigate();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await api.post<{
        accessToken: string;
        csrfToken: string;
        user: User;
      }>("/auth/login", { email, password });
      setAuth({
        user: response.data.user,
        accessToken: response.data.accessToken,
        csrfToken: response.data.csrfToken,
      });
      connectSocket(response.data.accessToken);
      navigate("/dashboard");
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      if (!axiosError.response) {
        setError("Cannot reach backend. Check API URL, backend status, and CORS settings.");
      } else if (axiosError.response.status === 401) {
        setError("Invalid email or password.");
      } else {
        setError(axiosError.response.data?.message ?? "Login failed.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand header */}
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/40">
            <ShieldCheck size={26} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Welcome back</h1>
            <p className="text-slate-400 text-sm mt-1">
              Sign in to manage your schedules across locations.
            </p>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-xl border border-slate-700 bg-slate-800/60 backdrop-blur p-6 shadow-2xl space-y-5">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-slate-300">
                Email address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-300">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:ring-blue-500 focus:ring-offset-slate-800"
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-2.5">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-10 text-sm font-semibold"
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500">
          ShiftSync · Coastal Eats Scheduling Platform
        </p>
      </div>
    </div>
  );
}
