import { getCountryHotspots } from "@/lib/hotspots";

// Keeps the FIRMS MAP_KEY on the server and returns compact [lon, lat, frp, sensor, inside] points.
// The landing globe uses sample points, so live data is only ever requested for one country.
export async function GET(request) {
  const iso3 = request.nextUrl.searchParams.get("country")?.toUpperCase();

  if (!iso3 || !/^[A-Z]{3}$/.test(iso3)) {
    return Response.json({ error: "A three-letter country code is required" }, { status: 400 });
  }

  try {
    const data = await getCountryHotspots(iso3);
    if (!data) return Response.json({ error: "Unknown country" }, { status: 404 });
    return Response.json(data, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=300" },
    });
  } catch (error) {
    console.error("Hotspot request failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Hotspot feed unavailable" }, { status: 502 });
  }
}
