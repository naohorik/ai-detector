import type { NextApiRequest, NextApiResponse } from "next";

// ── 型定義 ──────────────────────────────────────────────
type SuccessResponse = {
  aiScore: number;       // AI生成らしさ: 0〜100
  humanScore: number;    // 人間らしさ: 0〜100
  verdict: "human" | "unclear" | "ai";
  label: string;         // 日本語ラベル
};

type ErrorResponse = {
  error: string;
};

// HuggingFace API のレスポンス型
type HFResult = { label: string; score: number }[];

// ── 定数 ────────────────────────────────────────────────
const MIN_CHARS = 200;   // 最小文字数（論文・レポート向けに200文字以上）
const MAX_CHARS = 5000;  // 最大文字数
const CHUNK_SIZE = 400;  // モデルのトークン上限に合わせた1チャンクの文字数
const HF_MODEL_URL =
  "https://router.huggingface.co/hf-inference/models/Hello-SimpleAI/chatgpt-detector-roberta";

// スコアから判定ラベルを返す
function getVerdict(aiScore: number): {
  verdict: SuccessResponse["verdict"];
  label: string;
} {
  if (aiScore <= 30) return { verdict: "human", label: "人間が書いた可能性が高い" };
  if (aiScore <= 69) return { verdict: "unclear", label: "判断が難しい" };
  return { verdict: "ai", label: "AIが書いた可能性が高い" };
}

// ── ハンドラ ─────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  // POSTのみ受け付ける
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { text } = req.body;

  // バリデーション
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "テキストを入力してください" });
  }
  if (text.trim().length < MIN_CHARS) {
    return res
      .status(400)
      .json({ error: `${MIN_CHARS}文字以上のテキストを入力してください（現在: ${text.trim().length}文字）` });
  }
  if (text.trim().length > MAX_CHARS) {
    return res
      .status(400)
      .json({ error: `${MAX_CHARS.toLocaleString()}文字以内で入力してください` });
  }

  // APIキーチェック
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "APIキーが設定されていません" });
  }

  try {
    // 長文を CHUNK_SIZE 文字ごとに分割
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const chunk = text.slice(i, i + CHUNK_SIZE).trim();
      if (chunk.length > 0) chunks.push(chunk);
    }

    // 各チャンクをAPIに送って結果を収集
    const scores: { ai: number; human: number }[] = [];

    for (const chunk of chunks) {
      const hfRes = await fetch(HF_MODEL_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: chunk, options: { truncation: true } }),
      });

      // モデルがロード中の場合（コールドスタート）
      if (hfRes.status === 503) {
        return res.status(503).json({
          error: "モデルを起動中です。20〜30秒後にもう一度お試しください。",
        });
      }

      if (!hfRes.ok) {
        const errText = await hfRes.text();
        console.error("HuggingFace API error:", hfRes.status, errText);
        return res.status(500).json({ error: `判定エラー(${hfRes.status}): ${errText}` });
      }

      const raw = await hfRes.json();
      console.log("HuggingFace response:", JSON.stringify(raw));

      // レスポンス形式を柔軟に対応
      // 形式A: [[{label, score}, ...]]
      // 形式B: [{label, score}, ...]
      const results: HFResult = Array.isArray(raw[0]) ? raw[0] : raw;

      // ラベル名はモデルによって異なるため柔軟に対応
      // 例: "ChatGPT"/"Human", "LABEL_1"/"LABEL_0", "fake"/"real" など
      const aiEntry = results.find((r) =>
        /chatgpt|ai|fake|generated|label_1/i.test(r.label)
      );
      const humanEntry = results.find((r) =>
        /human|real|label_0/i.test(r.label)
      );

      // どちらかが見つからない場合は残りのエントリを使う
      const aiScore = aiEntry?.score ?? (humanEntry ? 1 - humanEntry.score : 0);
      const humanScore = humanEntry?.score ?? (aiEntry ? 1 - aiEntry.score : 0);

      scores.push({ ai: aiScore, human: humanScore });
    }

    // チャンクのスコアを平均して最終スコアを算出
    const avgAi = scores.reduce((sum, s) => sum + s.ai, 0) / scores.length;
    const avgHuman = scores.reduce((sum, s) => sum + s.human, 0) / scores.length;

    const aiScore = Math.round(avgAi * 100);
    const humanScore = Math.round(avgHuman * 100);

    const { verdict, label } = getVerdict(aiScore);

    return res.status(200).json({ aiScore, humanScore, verdict, label });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "予期しないエラーが発生しました" });
  }
}
