import { create } from "zustand";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
};

type NotificationState = {
  unreadCount: number;
  recent: NotificationItem[];
  setNotifications: (items: NotificationItem[]) => void;
  pushNotification: (item: NotificationItem) => void;
  markAllRead: () => void;
};

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  recent: [],
  setNotifications: (items) =>
    set({
      recent: items,
      unreadCount: items.filter((n) => !n.isRead).length,
    }),
  pushNotification: (item) => {
    const recent = [item, ...get().recent].slice(0, 50);
    set({ recent, unreadCount: recent.filter((n) => !n.isRead).length });
  },
  markAllRead: () =>
    set((state) => ({
      recent: state.recent.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    })),
}));
