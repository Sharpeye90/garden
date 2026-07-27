import { NextResponse } from "next/server";
import { ensureSchema, getPool } from "@/db";

export async function GET() {
  try {
    await ensureSchema();
    await getPool().query("SELECT 1");
    return NextResponse.json({
      status: "ok",
      service: "garden-rhythm",
      version: "alpha",
      database: "ready",
    });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json(
      { status: "degraded", service: "garden-rhythm", database: "unavailable" },
      { status: 503 },
    );
  }
}
