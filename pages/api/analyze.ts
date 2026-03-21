import type { NextApiRequest, NextApiResponse } from "next";

// ── 型定義 ──────────────────────────────────────────────
type SuccessResponse = {
  aiScore: number;
  humanScore: number;
  verdict: "human" | "unclear" | "ai";
  label: string;
  reasons: string[];
  highlights: string[];           // ハイライト対象フレーズ
  language: "ja" | "en" | "mixed"; // 検出言語
  languageWarning?: string;       // 日本語時の注意メッセージ
};

type ErrorResponse = { error: string };
type HFResult = { label: string; score: number }[];

// ── 定数 ────────────────────────────────────────────────
const MIN_CHARS = 200;
const MAX_CHARS = 5000;
const CHUNK_SIZE = 250;
const HF_MODEL_URL =
  "https://router.huggingface.co/hf-inference/models/openai-community/roberta-large-openai-detector";

// ── 言語検出 ─────────────────────────────────────────────
function detectLanguage(text: string): "ja" | "en" | "mixed" {
  const japaneseChars = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g);
  const ratio = (japaneseChars?.length ?? 0) / text.length;
  if (ratio > 0.3) return "ja";
  if (ratio > 0.05) return "mixed";
  return "en";
}

// ── ハイライト抽出 ────────────────────────────────────────
function extractHighlights(text: string, language: string): string[] {
  const patterns: RegExp[] = [];

  if (language === "en" || language === "mixed") {
    patterns.push(
      /\b(furthermore|moreover|additionally|in conclusion|in summary)\b/gi,
      /\b(it is important to note|it is worth noting|it is crucial to)\b/gi,
      /\b(significant|substantial|comprehensive|extensive|numerous)\b/gi,
      /\b(firstly|secondly|thirdly|lastly|in addition|as a result|therefore|thus|hence)\b/gi,
      /\b(leverag\w+|utiliz\w+|optimiz\w+|prioritiz\w+|streamlin\w+)\b/gi,
      /\b(delve into|tapestry|testament to|it's worth noting)\b/gi
    );
  }

  if (language === "ja" || language === "mixed") {
    patterns.push(
      /また、|さらに、|加えて、|それに加えて、/g,
      /重要です|重要である|重要と言えます|重要と考えられます/g,
      /考えられます|思われます|言えるでしょう|と言えます/g,
      /したがって、|そのため、|その結果、|これにより、/g,
      /まず、|次に、|最後に、|第一に、|第二に、/g,
      /本稿では|本論では|以上のことから|まとめると/g
    );
  }

  const found: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) found.push(...matches.map((m) => m.trim()));
  }
  return [...new Set(found)].slice(0, 10); // 重複除去・最大10件
}

// ── 判定理由の生成 ────────────────────────────────────────
function analyzeReasons(text: string, aiScore: number, language: string): string[] {
  const reasons: string[] = [];
  const sentences = text.split(/[.。!！?？\n]+/).filter((s) => s.trim().length > 10);
  const avgSentenceLen = sentences.reduce((sum, s) => sum + s.trim().length, 0) / (sentences.length || 1);

  const aiPhrases = [
    /\b(furthermore|moreover|additionally|in conclusion|in summary|it is important to note)\b/i,
    /\b(firstly|secondly|thirdly|lastly|in addition|as a result|therefore|thus|hence)\b/i,
    /\b(significant|substantial|crucial|essential|comprehensive|extensive|numerous)\b/i,
    /\b(leverag|utiliz|optimiz|prioritiz|streamlin)/i,
    /また、|さらに、|したがって、|そのため、|重要です|考えられます/,
  ];
  const humanPhrases = [
    /[！!]{2,}|[？?]{2,}/,
    /笑|www|草|ｗ|（笑）/,
    /\b(I think|I feel|I believe|in my opinion|personally)\b/i,
    /\b(honestly|frankly|actually|well,|you know)\b/i,
  ];

  const aiPhraseCount = aiPhrases.filter((p) => p.test(text)).length;
  const humanPhraseCount = humanPhrases.filter((p) => p.test(text)).length;
  const sentenceLengths = sentences.map((s) => s.trim().length);
  const maxLen = Math.max(...sentenceLengths, 1);
  const minLen = Math.min(...sentenceLengths, 1);
  const uniformity = minLen / maxLen;

  if (aiScore >= 70) {
    if (avgSentenceLen > 80) reasons.push("文が長く構造的で、AIに典型的な複雑な文体が見られます");
    if (aiPhraseCount >= 2) reasons.push(`「Furthermore」「In conclusion」などAIがよく使う接続表現が多く含まれています`);
    if (uniformity > 0.4 && sentences.length > 3) reasons.push("文の長さが均一で、AIが生成する文章に見られる規則的なリズムがあります");
    if (humanPhraseCount === 0) reasons.push("個人的な感情や口語表現がなく、AIらしい中立的な文体です");
    if (language === "ja") reasons.push("「また、」「考えられます」などAI日本語文に特有の表現が見られます");
    if (reasons.length === 0) reasons.push("全体的な文体・語彙のパターンがAI生成文章の特徴と一致しています");
  } else if (aiScore >= 31) {
    if (aiPhraseCount >= 1 && humanPhraseCount >= 1) reasons.push("AI的な表現と人間的な表現が混在しています");
    if (avgSentenceLen > 60) reasons.push("文が比較的長く構造的ですが、断定には情報が不足しています");
    if (reasons.length === 0) reasons.push("文体の特徴がAI・人間のどちらとも明確に一致しませんでした");
  } else {
    if (humanPhraseCount > 0) reasons.push("個人的な意見や感情を表す表現が含まれています");
    if (avgSentenceLen < 50) reasons.push("文が短く自然なリズムがあり、人間らしい文体です");
    if (uniformity < 0.3) reasons.push("文の長さにばらつきがあり、人間が書いた文章の特徴があります");
    if (reasons.length === 0) reasons.push("全体的な文体・語彙のパターンが人間の文章の特徴と一致しています");
  }
  return reasons;
}

// ── スコア判定 ────────────────────────────────────────────
function getVerdict(aiScore: number): { verdict: SuccessResponse["verdict"]; label: string } {
  if (aiScore <= 30) return { verdict: "human", label: "人間が書いた可能性が高い" };
  if (aiScore <= 69) return { verdict: "unclear", label: "判断が難しい" };
  return { verdict: "ai", label: "AIが書いた可能性が高い" };
}

// ── ハンドラ ─────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { text } = req.body;
  if (!text || typeof text !== "string") return res.status(400).json({ error: "テキストを入力してください" });
  if (text.trim().length < MIN_CHARS) return res.status(400).json({ error: `${MIN_CHARS}文字以上入力してください（現在: ${text.trim().length}文字）` });
  if (text.trim().length > MAX_CHARS) return res.status(400).json({ error: `${MAX_CHARS.toLocaleString()}文字以内で入力してください` });

  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "APIキーが設定されていません" });

  // 言語検出
  const language = detectLanguage(text);

  try {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_SIZE) {
      const chunk = text.slice(i, i + CHUNK_SIZE).trim();
      if (chunk.length > 0) chunks.push(chunk);
    }

    const scores: { ai: number; human: number }[] = [];

    for (const chunk of chunks) {
      const hfRes = await fetch(HF_MODEL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: chunk, options: { truncation: true } }),
      });

      if (hfRes.status === 503) return res.status(503).json({ error: "モデルを起動中です。20〜30秒後にもう一度お試しください。" });
      if (!hfRes.ok) {
        const errText = await hfRes.text();
        return res.status(500).json({ error: `判定エラー(${hfRes.status}): ${errText}` });
      }

      const raw = await hfRes.json();
      const results: HFResult = Array.isArray(raw[0]) ? raw[0] : raw;
      const aiEntry = results.find((r) => /chatgpt|ai|fake|generated|label_1/i.test(r.label));
      const humanEntry = results.find((r) => /human|real|label_0/i.test(r.label));
      const ai = aiEntry?.score ?? (humanEntry ? 1 - humanEntry.score : 0);
      const human = humanEntry?.score ?? (aiEntry ? 1 - aiEntry.score : 0);
      scores.push({ ai, human });
    }

    const avgAi = scores.reduce((sum, s) => sum + s.ai, 0) / scores.length;
    const avgHuman = scores.reduce((sum, s) => sum + s.human, 0) / scores.length;
    const aiScore = Math.round(avgAi * 100);
    const humanScore = Math.round(avgHuman * 100);

    const { verdict, label } = getVerdict(aiScore);
    const reasons = analyzeReasons(text, aiScore, language);
    const highlights = extractHighlights(text, language);

    const languageWarning =
      language === "ja"
        ? "このモデルは英語テキスト向けに訓練されているため、日本語の精度は低下する場合があります"
        : language === "mixed"
        ? "日英混在のテキストが検出されました。英語部分の判定精度が高くなります"
        : undefined;

    return res.status(200).json({ aiScore, humanScore, verdict, label, reasons, highlights, language, languageWarning });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "予期しないエラーが発生しました" });
  }
}
