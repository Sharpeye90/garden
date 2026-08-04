import { NextResponse } from "next/server";

export const revalidate = 86_400;

type GeocodingResult = {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  admin2?: string;
  admin3?: string;
};

function roundedWeatherCoordinate(value: number): number {
  return Math.round(value * 20) / 20;
}

function pilotRegion(value?: string): string | null {
  const normalized = value?.toLocaleLowerCase("ru-RU") ?? "";
  if (normalized.includes("московск")) return "Московская область";
  if (normalized.includes("тверск")) return "Тверская область";
  if (normalized.includes("владимирск")) return "Владимирская область";
  return null;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: "invalid_location_query" }, { status: 422 });
  }

  const params = new URLSearchParams({
    name: query,
    count: "20",
    language: "ru",
    countryCode: "RU",
    format: "json",
  });

  try {
    const response = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?${params}`,
      {
        headers: { "user-agent": "GardenRhythmPilot/0.1" },
        next: { revalidate: 86_400 },
      },
    );
    if (!response.ok) throw new Error("geocoding_provider_error");

    const payload = (await response.json()) as { results?: GeocodingResult[] };
    const seen = new Set<string>();
    const results = (payload.results ?? []).flatMap((result) => {
      const region = pilotRegion(result.admin1);
      if (
        !region ||
        !result.name ||
        !Number.isFinite(result.latitude) ||
        !Number.isFinite(result.longitude)
      ) {
        return [];
      }

      const latitude = roundedWeatherCoordinate(result.latitude as number);
      const longitude = roundedWeatherCoordinate(result.longitude as number);
      const key = `${result.name}:${latitude}:${longitude}`;
      if (seen.has(key)) return [];
      seen.add(key);

      const area = [result.admin3, result.admin2]
        .find((value) => value && value !== result.name && value !== result.admin1);
      return [{
        id: String(result.id ?? key),
        name: result.name,
        region,
        area: area ?? null,
        latitude,
        longitude,
      }];
    });

    return NextResponse.json(
      {
        results,
        attribution: "Location data by GeoNames via Open-Meteo.com",
      },
      {
        headers: { "cache-control": "public, max-age=3600, s-maxage=86400" },
      },
    );
  } catch {
    return NextResponse.json({ error: "location_search_unavailable" }, { status: 503 });
  }
}
