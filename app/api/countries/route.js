import { listCountries } from "@/lib/countries";

export async function GET() {
  return Response.json(listCountries(), {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
