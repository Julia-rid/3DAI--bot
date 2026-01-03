import { NextResponse } from "next/server";

const ENGINE_URL = process.env.VOICEVOX_ENGINE_URL || "http://127.0.0.1:50021";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text: string = body?.text;
    const speaker: number = body?.speaker ?? 1;
    const params = body?.params ?? {};

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    // 1) audio_query
    const qRes = await fetch(
      `${ENGINE_URL}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
      { method: "POST" }
    );
    if (!qRes.ok) {
      return NextResponse.json({ error: await qRes.text() }, { status: 500 });
    }
    const query = await qRes.json();

    // 2) tune
    const tuned = {
      ...query,
      speedScale: params.speedScale ?? 1.12,
      pitchScale: params.pitchScale ?? 0.0,
      intonationScale: params.intonationScale ?? 1.18,
      volumeScale: params.volumeScale ?? 1.0,
      prePhonemeLength: params.prePhonemeLength ?? 0.0,
      postPhonemeLength: params.postPhonemeLength ?? 0.1,
    };

    // 3) synthesis
    const sRes = await fetch(`${ENGINE_URL}/synthesis?speaker=${speaker}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tuned),
    });
    if (!sRes.ok) {
      return NextResponse.json({ error: await sRes.text() }, { status: 500 });
    }

    const arrayBuf = await sRes.arrayBuffer();
    return new NextResponse(arrayBuf, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
