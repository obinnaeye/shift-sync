import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { useNavigate } from "react-router-dom";
import { formatInTimeZone } from "date-fns-tz";
import type { Shift } from "../../types";

type Props = {
  shifts: Shift[];
  timezone: string;
};

export function ScheduleCalendar({ shifts, timezone }: Props) {
  const navigate = useNavigate();

  const events = shifts.map((shift) => ({
    id: shift.id,
    title: `${shift.skill?.name ?? "Shift"}`,
    start: shift.startTime,
    end: shift.endTime,
    backgroundColor: shift.isPremium ? "#92400e" : "#1d4ed8",
    borderColor: shift.isPremium ? "#78350f" : "#1e3a8a",
    extendedProps: { shift },
  }));

  return (
    <FullCalendar
      plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      events={events}
      timeZone={timezone}
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay",
      }}
      eventClick={(info) => navigate(`/shifts/${info.event.id}`)}
      eventContent={(arg) => {
        const shift = arg.event.extendedProps.shift as Shift;
        const startLabel = formatInTimeZone(
          arg.event.start ?? new Date(),
          timezone,
          "h:mm a",
        );
        const endLabel = formatInTimeZone(
          arg.event.end ?? new Date(),
          timezone,
          "h:mm a",
        );
        return (
          <div className="px-1 py-0.5 overflow-hidden">
            <div className="font-semibold text-white leading-tight truncate">
              {arg.event.title}
            </div>
            <div className="text-white/80 leading-tight text-[11px]">
              {startLabel} – {endLabel}
            </div>
            {shift.isPremium && (
              <div className="text-[10px] text-amber-200 font-medium">★ Premium</div>
            )}
          </div>
        );
      }}
      height="auto"
      slotMinTime="06:00:00"
      slotMaxTime="23:00:00"
      nowIndicator
      allDaySlot={false}
    />
  );
}
