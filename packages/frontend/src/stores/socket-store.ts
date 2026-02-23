import { create } from "zustand";
import { io, type Socket } from "socket.io-client";

type SocketState = {
  socket: Socket | null;
  isConnected: boolean;
  requestedLocationIds: string[];
  connect: (token: string) => void;
  joinRooms: (locationIds: string[]) => void;
  disconnect: () => void;
};

const socketBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
  "/api/v1",
  "",
);

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  requestedLocationIds: [],
  connect: (token: string) => {
    const existing = get().socket;
    if (existing && existing.connected) {
      const requested = get().requestedLocationIds;
      existing.emit("rooms:join", { locationIds: requested });
      return;
    }
    if (existing && !existing.connected) {
      existing.auth = { token };
      existing.connect();
      return;
    }
    const socket = io(socketBaseUrl ?? "http://localhost:4000", {
      auth: { token },
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => {
      const requested = get().requestedLocationIds;
      socket.emit("rooms:join", { locationIds: requested });
      set({ isConnected: true });
    });
    socket.on("disconnect", () => set({ isConnected: false }));
    set({ socket });
  },
  joinRooms: (locationIds: string[]) => {
    const requested = [...new Set(locationIds.filter(Boolean))];
    const merged = [...new Set([...get().requestedLocationIds, ...requested])];
    set({ requestedLocationIds: merged });
    const socket = get().socket;
    if (socket && socket.connected) {
      socket.emit("rooms:join", { locationIds: requested });
    }
  },
  disconnect: () => {
    const socket = get().socket;
    if (socket) socket.disconnect();
    set({ socket: null, isConnected: false, requestedLocationIds: [] });
  },
}));
