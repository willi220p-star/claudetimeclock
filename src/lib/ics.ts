// "Add my roster to my phone calendar" (5 Oct): an iCalendar file built in the browser, no service.
// Darwin has no daylight saving (always +09:30), so times convert to UTC exactly.

type RosterDay = { work_date: string; start_time: string; end_time: string };

const utc = (instant: Date) => instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const darwin = (date: string, time: string) => utc(new Date(`${date}T${time.slice(0, 5)}:00+09:30`));
const escape = (text: string) => text.replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\n/g, "\\n");

export function rosterIcs(days: RosterDay[], place: string, now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DGK Business Consultancy//DGK Clock//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const day of days) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${day.work_date}-${day.start_time.slice(0, 5).replace(":", "")}@dgk-clock`,
      `DTSTAMP:${utc(now)}`,
      `DTSTART:${darwin(day.work_date, day.start_time)}`,
      `DTEND:${darwin(day.work_date, day.end_time)}`,
      "SUMMARY:DGK placement",
      `LOCATION:${escape(place)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
