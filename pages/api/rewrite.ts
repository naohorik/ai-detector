import type { NextApiRequest, NextApiResponse } from "next";

// ── 型定義 ──────────────────────────────────────────────
export type RewriteSuggestion = {
  original: string;     // 元の文
  rewritten: string;    // 書き直し案
  reason: string;       // 理由
  type: "phrase" | "structure" | "length" | "tone"; // 変更の種類
};

type SuccessResponse = {
  suggestions: RewriteSuggestion[];
  rewrittenFull: string; // 全体の書き直し版
};

type ErrorResponse = { error: string };

// ── 日本語の変換ルール ────────────────────────────────────
const JA_PHRASE_RULES: { pattern: RegExp; replace: string; reason: string }[] = [
  // 冗長な可能性表現
  { pattern: /することができます/g, replace: "できます", reason: "「することができます」→「できます」に短縮（自然な表現）" },
  { pattern: /することが可能です/g, replace: "できます", reason: "「することが可能です」→「できます」に短縮" },
  { pattern: /と考えられます/g, replace: "と思います", reason: "「と考えられます」→「と思います」（より人間的な表現）" },
  { pattern: /と思われます/g, replace: "と思います", reason: "「と思われます」→「と思います」（断定を避けた曖昧な表現を改善）" },
  { pattern: /と言えるでしょう/g, replace: "と言えます", reason: "「〜でしょう」→「〜ます」（語尾を整える）" },
  { pattern: /と言えます。/g, replace: "です。", reason: "「〜と言えます」→「〜です」（よりシンプルに）" },
  // AI的な接続詞
  { pattern: /^また、/gm, replace: "それと、", reason: "「また、」→「それと、」（繰り返しを避ける）" },
  { pattern: /^さらに、/gm, replace: "", reason: "「さらに、」を削除（文をつなぎ直す）" },
  { pattern: /^加えて、/gm, replace: "", reason: "「加えて、」を削除（接続詞の過多を減らす）" },
  { pattern: /^したがって、/gm, replace: "だから、", reason: "「したがって、」→「だから、」（より口語的に）" },
  { pattern: /^そのため、/gm, replace: "なので、", reason: "「そのため、」→「なので、」（より自然な流れ）" },
  { pattern: /^これにより、/gm, replace: "", reason: "「これにより、」を削除（冗長な前置きを省く）" },
  // フォーマルすぎる表現
  { pattern: /重要です。/g, replace: "大切です。", reason: "「重要です」→「大切です」（より親しみやすい表現）" },
  { pattern: /重要である/g, replace: "大切だ", reason: "「重要である」→「大切だ」（硬い表現を柔らかく）" },
  { pattern: /必要不可欠/g, replace: "欠かせない", reason: "「必要不可欠」→「欠かせない」（より自然な日本語）" },
  { pattern: /本稿では/g, replace: "ここでは", reason: "「本稿では」→「ここでは」（論文調を避ける）" },
  { pattern: /以上のことから/g, replace: "こういった理由から", reason: "「以上のことから」→「こういった理由から」（自然な流れ）" },
  { pattern: /まとめると/g, replace: "つまり", reason: "「まとめると」→「つまり」（シンプルに）" },
];

// ── 英語の変換ルール ──────────────────────────────────────
const EN_PHRASE_RULES: { pattern: RegExp; replace: string; reason: string }[] = [
  { pattern: /\bFurthermore,?\s/gi, replace: "Also, ", reason: '"Furthermore" → "Also" (simpler transition)' },
  { pattern: /\bMoreover,?\s/gi, replace: "Also, ", reason: '"Moreover" → "Also" (more natural)' },
  { pattern: /\bAdditionally,?\s/gi, replace: "Plus, ", reason: '"Additionally" → "Plus" (more conversational)' },
  { pattern: /\bIn conclusion,?\s/gi, replace: "So, ", reason: '"In conclusion" → "So" (less formal)' },
  { pattern: /\bIn summary,?\s/gi, replace: "Overall, ", reason: '"In summary" → "Overall"' },
  { pattern: /\bIt is important to note that\s/gi, replace: "Note that ", reason: 'Remove "It is important to note that" (verbose)' },
  { pattern: /\bIt is worth noting that\s/gi, replace: "", reason: 'Remove "It is worth noting that" (filler phrase)' },
  { pattern: /\bIt is crucial to\s/gi, replace: "You need to ", reason: '"It is crucial to" → "You need to"' },
  { pattern: /\bsignificant\b/gi, replace: "major", reason: '"significant" → "major" (less AI-buzzword-y)' },
  { pattern: /\bsubstantial\b/gi, replace: "large", reason: '"substantial" → "large"' },
  { pattern: /\bcomprehensive\b/gi, replace: "thorough", reason: '"comprehensive" → "thorough"' },
  { pattern: /\bleverag(e|ing)\b/gi, replace: "use", reason: '"leverage" → "use" (plain language)' },
  { pattern: /\butiliz(e|ing)\b/gi, replace: "use", reason: '"utilize" → "use" (simpler)' },
  { pattern: /\bFirstly,?\s/gi, replace: "First, ", reason: '"Firstly" → "First"' },
  { pattern: /\bSecondly,?\s/gi, replace: "Second, ", reason: '"Secondly" → "Second"' },
  { pattern: /\bLastly,?\s/gi, replace: "Finally, ", reason: '"Lastly" → "Finally"' },
  { pattern: /\bdelve into\b/gi, replace: "look at", reason: '"delve into" → "look at" (AI cliché)' },
];

// ── 文分割 ───────────────────────────────────────────────
function splitSentences(text: string, language: string): string[] {
  if (language === "ja" || language === "mixed") {
    return text.split(/(?<=[。！？])\s*/).filter((s) => s.trim().length > 5);
  }
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
}

// ── 文の長さチェック ──────────────────────────────────────
function getSentenceLengthSuggestions(sentences: string[], language: string): RewriteSuggestion[] {
  const threshold = language === "ja" ? 100 : 150;
  const suggestions: RewriteSuggestion[] = [];

  for (const sent of sentences) {
    if (sent.length > threshold) {
      const midPoint = Math.floor(sent.length / 2);
      let splitIdx = -1;

      if (language === "ja") {
        // 読点（、）または「が」「で」「に」あたりで区切る
        for (let i = midPoint; i < sent.length - 20; i++) {
          if (sent[i] === "、" || sent[i] === "が" || sent[i] === "て") {
            splitIdx = i + 1;
            break;
          }
        }
      } else {
        // カンマ or 接続詞で区切る
        const commaIdx = sent.indexOf(",", midPoint);
        if (commaIdx > 0 && commaIdx < sent.length - 20) splitIdx = commaIdx + 1;
      }

      if (splitIdx > 0) {
        const part1 = sent.slice(0, splitIdx).trim();
        const part2 = sent.slice(splitIdx).trim();
        const capitalized = language !== "ja" ? part2.charAt(0).toUpperCase() + part2.slice(1) : part2;
        suggestions.push({
          original: sent,
          rewritten: `${part1}${language === "ja" ? "。" : "."} ${capitalized}`,
          reason: language === "ja" ? `${sent.length}文字の長文を2文に分割（読みやすさ向上）` : `Long sentence split into two (${sent.length} chars)`,
          type: "length",
        });
      }
    }
  }

  return suggestions.slice(0, 2);
}

// ── フレーズ変換 ──────────────────────────────────────────
function applyPhraseRules(text: string, language: string): { text: string; suggestions: RewriteSuggestion[] } {
  const rules = language === "en" ? EN_PHRASE_RULES : JA_PHRASE_RULES;
  const suggestions: RewriteSuggestion[] = [];
  let modified = text;

  for (const rule of rules) {
    if (rule.pattern.test(modified)) {
      rule.pattern.lastIndex = 0; // Reset for global regex
      const originalSnippet = extractContext(modified, rule.pattern);
      const newText = modified.replace(rule.pattern, rule.replace);
      if (newText !== modified && originalSnippet) {
        const newSnippet = originalSnippet.replace(rule.pattern, rule.replace);
        suggestions.push({
          original: originalSnippet,
          rewritten: newSnippet,
          reason: rule.reason,
          type: "phrase",
        });
        modified = newText;
        rule.pattern.lastIndex = 0;
      }
    }
    rule.pattern.lastIndex = 0;
  }

  return { text: modified, suggestions };
}

// ── 文脈抽出（変更箇所を含む文を取得） ───────────────────
function extractContext(text: string, pattern: RegExp): string | null {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  if (!match) return null;

  const idx = match.index;
  const start = Math.max(0, text.lastIndexOf("。", idx - 1) + 1 || text.lastIndexOf(". ", idx - 1) + 2 || 0);
  const endJa = text.indexOf("。", idx + match[0].length);
  const endEn = text.indexOf(". ", idx + match[0].length);
  const end = endJa > 0 ? endJa + 1 : endEn > 0 ? endEn + 2 : Math.min(text.length, idx + 100);

  pattern.lastIndex = 0;
  return text.slice(start, end).trim();
}

// ── メインハンドラ ────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { text, language = "en" } = req.body;
  if (!text || typeof text !== "string") return res.status(400).json({ error: "テキストを入力してください" });
  if (text.trim().length < 50) return res.status(400).json({ error: "テキストが短すぎます" });

  try {
    const effectiveLang = language === "mixed" ? "ja" : language;

    // フレーズ変換
    const { text: rewrittenFull, suggestions: phraseSuggestions } = applyPhraseRules(text, effectiveLang);

    // 文の長さ提案
    const sentences = splitSentences(text, effectiveLang);
    const lengthSuggestions = getSentenceLengthSuggestions(sentences, effectiveLang);

    // 結合してスコア順に並べ（最大6件）
    const allSuggestions = [...phraseSuggestions, ...lengthSuggestions].slice(0, 6);

    return res.status(200).json({
      suggestions: allSuggestions,
      rewrittenFull,
    });
  } catch (err) {
    console.error("Rewrite error:", err);
    return res.status(500).json({ error: "書き直し提案の生成に失敗しました" });
  }
}
