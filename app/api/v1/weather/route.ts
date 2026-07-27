import { NextResponse } from "next/server";

export const revalidate = 10800;

const WEATHER_DESCRIPTION: Record<number, string> = {
  0: "Ясно",
  1: "Преимущественно ясно",
  2: "Переменная облачность",
  3: "Пасмурно",
  45: "Туман",
  51: "Лёгкая морось",
  61: "Небольшой дождь",
  63: "Дождь",
  80: "Кратковременный дождь",
  95: "Возможна гроза",
};

function rounded(value: number) {
  return Math.round(value * 20) / 20;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("latitude"));
  const longitude = Number(url.searchParams.get("longitude"));
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < 53 ||
    latitude > 59 ||
    longitude < 32 ||
    longitude > 41
  ) {
    return NextResponse.json({ error: "unsupported_pilot_region" }, { status: 422 });
  }

  const params = new URLSearchParams({
    latitude: String(rounded(latitude)),
    longitude: String(rounded(longitude)),
    current:
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily: "precipitation_probability_max,temperature_2m_max,temperature_2m_min",
    timezone: "Europe/Moscow",
    forecast_days: "7",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      headers: { "user-agent": "GardenRhythmPilot/0.1" },
      next: { revalidate: 10800 },
    });
    if (!response.ok) throw new Error("weather_provider_error");
    const data = (await response.json()) as {
      current: {
        temperature_2m: number;
        apparent_temperature: number;
        precipitation: number;
        weather_code: number;
        wind_speed_10m: number;
      };
      daily: {
        time: string[];
        precipitation_probability_max: number[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
      };
    };
    return NextResponse.json(
      {
        current: {
          temperature: data.current.temperature_2m,
          apparentTemperature: data.current.apparent_temperature,
          precipitation: data.daily.precipitation_probability_max[0] ?? 0,
          wind: data.current.wind_speed_10m / 3.6,
          description:
            WEATHER_DESCRIPTION[data.current.weather_code] ?? "Погода меняется",
        },
        daily: data.daily,
        locationPrecision: "0.05_degree",
        attribution: "Weather data by Open-Meteo.com",
      },
      {
        headers: { "cache-control": "public, max-age=1800, s-maxage=10800" },
      },
    );
  } catch {
    return NextResponse.json({ error: "weather_unavailable" }, { status: 503 });
  }
}
