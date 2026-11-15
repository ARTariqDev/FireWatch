import { revalidateTag } from "next/cache";
import { countryHotspotTag, getCountryHotspots } from "@/lib/hotspots";

// Keeps the FIRMS MAP_KEY on the server and returns compact [lon, lat, frp, sensor, inside, acquired] points.
// The landing globe uses sample points, so live data is only ever requested for one country.
async function respond(request, refresh) {
  const iso3 = request.nextUrl.searchParams.get("country")?.toUpperCase();
  const date = request.nextUrl.searchParams.get("date");
  const dayRange = request.nextUrl.searchParams.get("dayRange");
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const numDays = dayRange && Number(dayRange) >= 1 && Number(dayRange) <= 14 ? Number(dayRange) : undefined;

  const isForce = refresh || request.nextUrl.searchParams.get("refresh") === "true";

  if (!iso3 || !/^[A-Z]{3}$/.test(iso3)) {
    return Response.json({ error: "A three-letter country code is required" }, { status: 400 });
  }

  try {
    if (isForce) revalidateTag(countryHotspotTag(iso3, validDate || ""), { expire: 0 });
    const data = await getCountryHotspots(iso3, { date: validDate, dayRange: numDays });
    if (!data) return Response.json({ error: "Unknown country" }, { status: 404 });
    return Response.json(data, {
      headers: { "Cache-Control": isForce ? "no-store" : "public, s-maxage=900, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Hotspot request failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Hotspot feed unavailable" }, { status: 502 });
  }
}

export const GET = (request) => respond(request, false);
export const POST = (request) => respond(request, true);
