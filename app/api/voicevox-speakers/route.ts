import { NextResponse } from "next/server";

const ENGINE_URL = process.env.VOICEVOX_ENGINE_URL || "http://127.0.0.1:50021";

export async function GET() {
  try {
    const r = await fetch(`${ENGINE_URL}/speakers`, { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ error: await r.text() }, { status: 500 });
    }
    const data = await r.json();
    return NextResponse.json(data, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
