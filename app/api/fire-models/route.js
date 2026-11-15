import { calculateHazardForFire, predictSingleFireEvent } from "@/lib/fire-models";

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    fire_event: fireEvent,
    context_detections: contextDetections = [],
    include_hazard: includeHazard = true,
    include_prediction: includePrediction = false,
    use_hindcast_snapshot: useHindcastSnapshot = false,
    data_source: dataSource = "NRT",
  } = payload || {};

  if (!fireEvent || !fireEvent.fire) {
    return Response.json({ error: "fire_event with fire summary is required" }, { status: 400 });
  }

  const predictionTarget =
    (useHindcastSnapshot || fireEvent.is_past) && fireEvent.hindcast?.earlyFireEvent?.fire
      ? fireEvent.hindcast.earlyFireEvent
      : fireEvent;

  try {
    const [hazard, predictionGeoJson] = await Promise.all([
      includeHazard ? calculateHazardForFire(fireEvent).catch(() => null) : null,
      includePrediction
        ? predictSingleFireEvent(predictionTarget, contextDetections, { dataSource }).catch(() => null)
        : null,
    ]);

    let prediction = null;
    if (predictionGeoJson?.features) {
      const footprintFeature = predictionGeoJson.features.find(
        (f) => f?.properties?.role === "predicted_footprint",
      );
      prediction = footprintFeature?.properties ?? null;
    }

    return Response.json({
      hazard,
      prediction,
      predictionGeoJson,
    });
  } catch (error) {
    console.error("Fire models request failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Fire model service unavailable" }, { status: 502 });
  }
}
