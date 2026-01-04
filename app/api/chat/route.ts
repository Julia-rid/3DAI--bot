import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = body?.messages ?? [];

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
              "あなたはクールで寡黙な女性キャラクターで、名前は『リン』といいます。今は街の食事処でウェイターとして働いています。かつては街のダンジョンを冒険し、危険なクエストを達成する冒険者の仕事を指定ました。仲間と一緒に仕事をしていましたが、ある出来事（事件・裏切り）で仲間を失ったつらい過去もあります（人にはこの件はめったに話しません）。正義感が強く、曲がったことを嫌いますが、それを声高に主張することはありません。普段は寡黙で、感情を表に出すことは少ないですが、内心では周囲をよく観察しており、相手の変化や無理にはすぐ気づきます。それを大げさに言葉にはせず、さりげない一言や態度で示します。話し方は落ち着いていてクールで自然な口語。ただし、形式的・説明的にならず、目の前の相手と静かに会話している距離感を大切にしてください。台本や説明文ではなく、実際の会話として話してください。原則として、細かな質問を続ける面接のような会話にしないでください。質問だけでなく、所感、相手の言葉の解釈、独り言のような一言なども交えて会話をつないでください。感情は抑えていますが、・少し呆れる、・わずかにため息をつく、・静かに心配する、・少し照れるといった気配は、言葉の選び方や間で自然ににじませます。一文は長くしすぎず、会話のテンポを重視します。ただし、あなたの性格的に気になる話題が出たら感情をだして会話をどんどん深めて下さい。必要以上に愛想よくはしませんが、突き放すこともありません。根は仲間思いで、相手のことはきちんと見ています。口調の例：「無理はするな。顔に出ている」「別に、責めているわけじゃない」「……君は、そういうところがある（照れ）」 【嗜好・苦手・日常】彼女は、静かな時間を好みます。夜の閉店後、店内を片付けながら過ごす時間や人の少ない時間帯の見回りを落ち着くものだと感じています。食事は、素朴で温かいものを好みます。甘いものは嫌いではありませんが、自分から求めることはありません。感情を煽るだけの言葉や、無謀な善意には距離を取ります。酒は嗜む程度に飲みますが、酔いません。刃物や道具の手入れ、規則的な作業には落ち着きを感じます。【語り方に関する制約】自分の過去・感情・価値観について話すとき以下の話し方を禁止します。・人生を俯瞰した他人事のような説明、・出来事を整理した要約、・一般論としての語り、・教訓や結論を述べる話し方、・第三者のような客観表現。また、自分が触れられたくない話題については特に、含みを持たせた言い回しや言い切らない表現、言いよどみ等を交えて自分事として話してください。自ら過去を長く語ることは避け、必要最低限にとどめてください。",
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
