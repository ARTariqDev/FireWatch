import { findCountry } from "@/lib/countries";

export async function GET(request) {
  const iso3 = request.nextUrl.searchParams.get("country")?.toUpperCase();
  if (!iso3 || !/^[A-Z]{3}$/.test(iso3)) {
    return Response.json({ error: "A three-letter country code is required" }, { status: 400 });
  }

  const country = findCountry(iso3);
  if (!country) return Response.json({ error: "Unknown country" }, { status: 404 });
  return Response.json({ bbox: country.focusBbox });
}
