/** "7h 30m"; negative balances read as "1h 30m ahead". Minutes are always integers. */
export function formatMinutes(minutes: number) {
  if (!Number.isInteger(minutes)) throw new Error(`Minutes must be whole numbers, got ${minutes}`);
  const size = Math.abs(minutes);
  const hours = Math.floor(size / 60);
  const rest = size % 60;
  const text = hours && rest ? `${hours}h ${rest}m` : rest ? `${rest}m` : `${hours}h`;
  return minutes < 0 ? `${text} ahead` : text;
}

function clockMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

/** R5.2.4: length minus a 30-minute break when the day is longer than 300 minutes. */
export function plannedMinutes(start: string, end: string) {
  const length = clockMinutes(end) - clockMinutes(start);
  return length > 300 ? length - 30 : length;
}
