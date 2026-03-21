import type { NextApiRequest, NextApiResponse } from "next";

// ── 型定義 ──────────────────────────────────────────────
type SuccessResponse = {
  aiScore: number;       // AI生成らしさ: 0〜100
  humanScore: number;    // 人間らしさ: 0〜100
  verdict: "human" | "unclear" | "ai";
  label: string;         // 日本語ラベル
  reasons: string[];     // 判定理由のリスト
};

type ErrorResponse = {
  error: string;
};

// HuggingFace API のレスポンス型
type HFResult = { label: string; score: number }[];

// ── 定数 ────────────────────────────────────────────────
const MIN_CHARS = 200;   // 最小文字数（論文・レポート向けに200文字以上）
const MAX_CHARS = 5000;  // 最大文字数
const CHUNK_SIZE = 250;  // モデルのトークン上限(512)に合わせた1チャンクの文字数
const HF_MODEL_URL =
  "https://router.huggingface.co/hf-inference/models/openai-community/roberta-large-openai-detector";

// スコアから判定ラベルを返す
function getVerdict(aiScore: number): {
  verdict: SuccessResponse["verdict"];
  label: string;
} {
  if (aiScore <= 30) return { verdict: "human", label: "人間が書いた可能性が高い" };
  if (aiScore <= 69) return { verdict: "unclear", label: "判断が難しい" };
  return { verdict: "ai", label: "AIが書いた可能性が高い" };
}

// ── テキストパターン分析 ──────────────────────────────────
function analyzeReasons(text: string, aiScore: number): string[] {
  const reasons: string[] = [];
  const sentences = text.split(/[.。!！?？\n]+/).filter((s) => s.trim().length > 10);
  const avgSentenceLen = sentences.reduce((sum, s) => sum + s.trim().length, 0) / (sentences.length || 1);

  // AI特有のパターンチェック
  const aiPhrases = [
    /\b(furthermore|moreover|additionally|in conclusion|in summary|it is important to note|it is worth noting)\b/i,
    /\b(firstly|secondly|thirdly|lastly|in addition|as a result|therefore|thus|hence)\b/i,
    /\b(significant|substantial|crucial|essential|comprehensive|extensive|numerous)\b/i,
    /\b(leverag|utiliz|optimiz|prioritiz|streamlin)/i,
    /(notably|particularly|especially).{0,30}(important|significant|crucial)/i,
  ];

  const humanPhrases = [
    /[！!]{2,}|[？?]{2,}/,      // 感嘆符・疑問符の連続
    /笑|www|草|ｗ|（笑）/,      // 日本語の感情表現
    /\b(I think|I feel|I believe|in my opinion|personally)\b/i,
    /\b(honestly|frankly|actually|well,|you know)\b/i,
  ];

  const aiPhraseCount = aiPhrases.filter((p) => p.test(text)).length;
  const humanPhraseCount = humanPhrases.filter((p) => p.test(text)).length;

  // 文章の長さの均一性チェック
  const sentenceLengths = sentences.map((s) => s.trim().length);
  const maxLen = Math.max(...sentenceLengths);
  const minLen = Math.min(...sentenceLengths);
  const uniformity = minLen / (maxLen || 1);

  if (aiScore >= 70) {
    // AI判定の理由
    if (avgSentenceLen > 80)
      reasons.push("文が長く構造的で、AIに典型的な複雑な文体が見られます");
    if (aiPhraseCount >= 2)
      reasons.push("「Furthermore」「In conclusion」などAIがよく使う接続表現が多く含まれています");
    if (uniformity > 0.4 && sentences.length > 3)
      reasons.push("文の長さが均一で、AIが生成する文章に見られる規則的なリズムがあります");
    if (humanPhraseCount === 0)
      reasons.push("個人的な感情や口語表現がなく、AIらしい中立的な文体です");
    if (reasons.length === 0)
      reasons.push("全体的な文体・語彙のパターンがAI生成文章の特徴と一致しています");
  } else if (aiScore >= 31) {
    // 判断が難しい理由
    if (aiPhraseCount >= 1 && humanPhraseCount >= 1)
      reasons.push("AI的な表現と人間的な表現が混在しています");
    if (avgSentenceLen > 60)
      reasons.push("文が比較的長く構造的ですが、断定には情報が不足しています");
    if (reasons.length === 0)
      reasons.push("文体の特徴がAI・人間のどちらとも明確に一致しませんでした");
  } else {
    // 人間判定の理由
    if (humanPhraseCount > 0)
      reasons.push("個人的な意見や感情を表す表現が含まれています");
    if (avgSentenceLen < 50)
      reasons.push("文が短く自然なリズムがあり、人間らしい文体です");
    if (uniformity < 0.3)
      reasons.push("文の長さにばらつきがあり、人間が書いた文章の特徴があります");
    if (reasons.length === 0)
      reasons.push("全体的な文体・語彙のパターンが人間の文章の特徴と一致しています");
  }

  return reasons;
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
    const reasons = analyzeReasons(text, aiScore);

    return res.status(200).json({ aiScore, humanScore, verdict, label, reasons });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "予期しないエラーが発生しました" });
  }
}
