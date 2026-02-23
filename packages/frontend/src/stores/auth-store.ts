import { create } from "zustand";
import type { User } from "../types";

const CSRF_STORAGE_KEY = "shiftsync_csrf_token";

function readInitialCsrfToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(CSRF_STORAGE_KEY);
}

function persistCsrfToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (!token) {
    window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
}

type AuthState = {
  currentUser: User | null;
  accessToken: string | null;
  csrfToken: string | null;
  isBootstrapped: boolean;
  setAuth: (input: { user: User; accessToken: string; csrfToken: string }) => void;
  setCurrentUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  setCsrfToken: (token: string | null) => void;
  markBootstrapped: () => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  accessToken: null,
  csrfToken: readInitialCsrfToken(),
  isBootstrapped: false,
  setAuth: ({ user, accessToken, csrfToken }) =>
    set(() => {
      persistCsrfToken(csrfToken);
      return { currentUser: user, accessToken, csrfToken, isBootstrapped: true };
    }),
  setCurrentUser: (currentUser) => set({ currentUser }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setCsrfToken: (csrfToken) =>
    set(() => {
      persistCsrfToken(csrfToken);
      return { csrfToken };
    }),
  markBootstrapped: () => set({ isBootstrapped: true }),
  logout: () =>
    set(() => {
      persistCsrfToken(null);
      return { currentUser: null, accessToken: null, csrfToken: null, isBootstrapped: true };
    }),
}));
