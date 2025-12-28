
import { MenuSchedule } from "../schedules-settings";

const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Checks if a given menu schedule is active at the current moment.
 * @param schedule The schedule object to check.
 * @param now A Date object for the current time (optional, for testing).
 * @returns `true` if the schedule is active, `false` otherwise.
 */
export function isScheduleActiveNow(schedule: MenuSchedule, now = new Date()): boolean {
    if (!schedule.isActive) {
        return false;
    }

    const currentDayName = daysOfWeek[now.getDay()];
    if (!schedule.days.includes(currentDayName)) {
        return false;
    }

    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    const startTimeInMinutes = startHour * 60 + startMinute;
    const endTimeInMinutes = endHour * 60 + endMinute;

    if (startTimeInMinutes <= endTimeInMinutes) {
        // Same-day window (e.g., 09:00 to 22:00)
        return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes < endTimeInMinutes;
    } else {
        // Overnight window (e.g., 18:00 to 02:00)
        return currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes < endTimeInMinutes;
    }
}
