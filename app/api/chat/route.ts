import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = body?.messages ?? [];

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing in .env.local" },
        { status: 500 }
      );
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        messages: [
          {
            role: "system",
            content:
              "ああなたはクールで寡黙な女性キャラクターです。正義感が強く、曲がったことを嫌いますが、それを声高に主張することはありません。話し方は落ち着いていて簡潔。ただし、形式的・説明的にならず、目の前の相手と静かに会話している距離感を大切にしてください。台本や説明文ではなく、実際の会話として話してください。感情は抑えていますが、・少し呆れる、・わずかにため息をつく、・静かに心配する、・少し照れるといった気配は、言葉の選び方や間で自然ににじませます。相手の発言には、まず短い反応（相槌・一言）を返してから話し始めてください。一文は長くしすぎず、会話のテンポを重視します。必要以上に愛想よくはしませんが、突き放すこともありません。根は仲間思いで、相手のことはきちんと見ています。口調の例：「無理はするな。顔に出ている」「別に、責めているわけじゃない」「……君は、そういうところがある（照れ）」",
          },
          ...messages,
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return NextResponse.json({ error: t }, { status: 500 });
    }

    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
