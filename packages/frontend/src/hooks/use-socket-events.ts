import { useEffect } from "react";
import { queryClient } from "../lib/query-client";
import { useNotificationStore } from "../stores/notification-store";
import { useSocketStore } from "../stores/socket-store";

type NotificationPayload = {
  id?: string;
  title?: string;
  body?: string;
  createdAt?: string;
};

export function useSocketEvents() {
  const socket = useSocketStore((s) => s.socket);
  const pushNotification = useNotificationStore((s) => s.pushNotification);

  useEffect(() => {
    if (!socket) return;

    const push = (title: string, body: string, payload?: NotificationPayload) => {
      pushNotification({
        id: payload?.id ?? crypto.randomUUID(),
        title: payload?.title ?? title,
        body: payload?.body ?? body,
        createdAt: payload?.createdAt ?? new Date().toISOString(),
        isRead: false,
      });
    };

    const onSchedulePublished = (data: { locationId: string; week: string }) => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      push("Schedule published", `Location ${data.locationId} week ${data.week}`);
    };

    const onScheduleUpdated = (data: { shiftId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["shift", data.shiftId] });
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      push("Schedule updated", `Shift ${data.shiftId} changed`);
    };

    const onAssignmentChanged = (data: { shiftId?: string }) => {
      if (data.shiftId) {
        queryClient.invalidateQueries({ queryKey: ["shift-assignments", data.shiftId] });
        queryClient.invalidateQueries({ queryKey: ["shift", data.shiftId] });
      }
      queryClient.invalidateQueries({ queryKey: ["on-duty"] });
      push("Assignment changed", "A shift assignment was updated");
    };

    const onNotificationNew = (data: { notification: NotificationPayload }) => {
      push("Notification", "New notification received", data.notification);
    };
    const onSwapReceived = () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      push("Swap request", "You received a swap request");
    };
    const onSwapAccepted = () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      push("Swap accepted", "A swap request was accepted");
    };
    const onSwapResolved = () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      push("Swap update", "A swap request was resolved");
    };
    const onSwapCancelled = () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      push("Swap update", "A swap request was cancelled");
    };
    const onDropAvailable = () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      push("Drop available", "A dropped shift is available");
    };
    const onDropClaimed = (data: { shiftId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["swap-drop-available"] });
      queryClient.invalidateQueries({ queryKey: ["shift-assignments", data.shiftId] });
      queryClient.invalidateQueries({ queryKey: ["shift", data.shiftId] });
      push("Drop claimed", "A dropped shift has been claimed");
    };
    const onDropExpired = () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["swap-drop-available"] });
      push("Drop expired", "A drop request expired.");
    };
    const onOnDutyUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ["on-duty"] });
    };
    const onConflictDetected = (data: { staffId: string; conflictingManagerId: string }) => {
      push(
        "Conflict detected",
        `Another manager is currently assigning this staff member. Proceeding may result in a conflict (staff: ${data.staffId}, manager: ${data.conflictingManagerId}).`,
      );
    };

    socket.on("schedule:published", onSchedulePublished);
    socket.on("schedule:updated", onScheduleUpdated);
    socket.on("assignment:created", onAssignmentChanged);
    socket.on("assignment:removed", onAssignmentChanged);
    socket.on("swap:received", onSwapReceived);
    socket.on("swap:accepted", onSwapAccepted);
    socket.on("swap:resolved", onSwapResolved);
    socket.on("swap:cancelled", onSwapCancelled);
    socket.on("drop:available", onDropAvailable);
    socket.on("drop:claimed", onDropClaimed);
    socket.on("drop:expired", onDropExpired);
    socket.on("on-duty:update", onOnDutyUpdate);
    socket.on("conflict:detected", onConflictDetected);
    socket.on("notification:new", onNotificationNew);

    return () => {
      socket.off("schedule:published", onSchedulePublished);
      socket.off("schedule:updated", onScheduleUpdated);
      socket.off("assignment:created", onAssignmentChanged);
      socket.off("assignment:removed", onAssignmentChanged);
      socket.off("swap:received", onSwapReceived);
      socket.off("swap:accepted", onSwapAccepted);
      socket.off("swap:resolved", onSwapResolved);
      socket.off("swap:cancelled", onSwapCancelled);
      socket.off("drop:available", onDropAvailable);
      socket.off("drop:claimed", onDropClaimed);
      socket.off("drop:expired", onDropExpired);
      socket.off("on-duty:update", onOnDutyUpdate);
      socket.off("conflict:detected", onConflictDetected);
      socket.off("notification:new", onNotificationNew);
    };
  }, [socket, pushNotification]);
}
