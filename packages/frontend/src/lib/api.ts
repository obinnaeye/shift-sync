import axios from "axios";
import { useAuthStore } from "../stores/auth-store";

const baseURL = import.meta.env.VITE_API_URL ?? "http://localhost:4000/api/v1";

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const csrfToken = useAuthStore.getState().csrfToken;
      if (!csrfToken) return null;
      try {
        const response = await api.post<{ accessToken: string; csrfToken: string }>(
          "/auth/refresh",
          {},
          { headers: { "X-CSRF-Token": csrfToken } },
        );
        useAuthStore.getState().setAccessToken(response.data.accessToken);
        useAuthStore.getState().setCsrfToken(response.data.csrfToken);
        return response.data.accessToken;
      } catch {
        useAuthStore.getState().logout();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const requestUrl = original?.url ?? "";
    const isRefreshRequest = requestUrl.includes("/auth/refresh");
    if (isRefreshRequest) {
      return Promise.reject(error);
    }
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      const token = await refreshAccessToken();
      if (token) {
        return api.request(original);
      }
    }
    return Promise.reject(error);
  },
);
