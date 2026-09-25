export const LOGIN_DOMAIN = "daymark.example.com";

export type Role = "admin" | "staff";
export type EventType = "shift_in" | "shift_out" | "break_in" | "break_out";
export type ShiftStatus = "off" | "on_shift" | "on_break";

export type Profile = {
  id: string;
  login_id: string;
  display_name: string;
  role: Role;
  active: boolean;
  created_at: string;
};

export type Punch = {
  id: string;
  user_id: string;
  event_type: EventType;
  occurred_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  photo_path: string;
  place_name: string | null;
};

export const WORK_SITE = {
  name: "Regus, first floor",
  address: "Regus, first floor, 1 Palmerston Circuit, Palmerston City, Palmerston NT 0830",
  latitude: -12.4785082,
  longitude: 130.9854825,
  radiusM: 200,
} as const;

export const EVENT_LABEL: Record<EventType, string> = {
  shift_in: "Shift clock in",
  shift_out: "Shift clock out",
  break_in: "Break clock in",
  break_out: "Break clock out",
};

export function emailForLogin(loginId: string) {
  return `${loginId.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
}

export function formatWhen(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function distanceMetres(
  latitude: number,
  longitude: number,
  siteLatitude = WORK_SITE.latitude,
  siteLongitude = WORK_SITE.longitude,
) {
  const earth = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(siteLatitude - latitude);
  const dLng = toRad(siteLongitude - longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latitude)) * Math.cos(toRad(siteLatitude)) * Math.sin(dLng / 2) ** 2;
  return earth * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(metres: number) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

type PhotonProperties = {
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  city?: string;
  state?: string;
  postcode?: string;
};

export async function describePlace(latitude: number, longitude: number) {
  if (distanceMetres(latitude, longitude) <= WORK_SITE.radiusM) return WORK_SITE.address;
  return lookupAddress(latitude, longitude);
}

async function lookupAddress(latitude: number, longitude: number) {
  try {
    const response = await fetch(
      `https://photon.komoot.io/reverse?lat=${latitude}&lon=${longitude}`,
    );
    if (response.ok) {
      const data = (await response.json()) as {
        features?: Array<{ properties?: PhotonProperties }>;
      };
      const line = formatPhoton(data.features?.[0]?.properties);
      if (line) return line;
    }
  } catch {
    // Fall through to the coarser lookup.
  }

  try {
    const response = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      locality?: string;
      city?: string;
      principalSubdivision?: string;
      postcode?: string;
    };
    const parts = [data.locality, data.city, data.principalSubdivision, data.postcode].filter(
      (part, index, all): part is string => Boolean(part) && all.indexOf(part) === index,
    );
    return parts.length > 0 ? parts.join(", ") : null;
  } catch {
    return null;
  }
}

function formatPhoton(properties: PhotonProperties | undefined) {
  if (!properties) return null;
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const parts = [properties.name, street, properties.district, properties.city, properties.state, properties.postcode]
    .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function offSiteMessage(latitude: number, longitude: number) {
  const metres = distanceMetres(latitude, longitude);
  if (metres <= WORK_SITE.radiusM) return null;
  return `You are out of the range. Be in the location. You are about ${formatDistance(metres)} away.`;
}

export function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatTimeOnly(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function dayHeading(dateKey: string, now = new Date()) {
  const today = localDateInput(now);
  const previous = new Date(now);
  previous.setDate(previous.getDate() - 1);
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, day || 1);
  const long = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  if (dateKey === today) return `Today · ${long}`;
  if (dateKey === localDateInput(previous)) return `Yesterday · ${long}`;
  return long;
}

export function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function localDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isSameLocalDay(iso: string, now: Date) {
  const date = new Date(iso);
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export function formatCoord(latitude: number, longitude: number) {
  const latHem = latitude >= 0 ? "N" : "S";
  const lngHem = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(5)}° ${latHem}, ${Math.abs(longitude).toFixed(5)}° ${lngHem}`;
}

export function mapLink(latitude: number, longitude: number) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}

export function mapEmbed(latitude: number, longitude: number) {
  const pad = 0.008;
  const bbox = [
    longitude - pad,
    latitude - pad,
    longitude + pad,
    latitude + pad,
  ].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

export function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return fallback;
}
