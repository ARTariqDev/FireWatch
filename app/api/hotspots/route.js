import { getCountryHotspots, getWorldHotspots } from "@/lib/hotspots";

// Keeps the FIRMS MAP_KEY on the server and returns compact [lon, lat, frp, sensor(, inside)] points.
export async function GET(request) {
  const iso3 = request.nextUrl.searchParams.get("country")?.toUpperCase();

  try {
    if (!iso3) return Response.json(await getWorldHotspots());

    if (!/^[A-Z]{3}$/.test(iso3)) {
      return Response.json({ error: "Invalid country code" }, { status: 400 });
    }
    const data = await getCountryHotspots(iso3);
    if (!data) return Response.json({ error: "Unknown country" }, { status: 404 });
    return Response.json(data);
  } catch (error) {
    console.error("Hotspot request failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Hotspot feed unavailable" }, { status: 502 });
  }
}
