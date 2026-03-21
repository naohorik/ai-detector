import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";

// ── 型定義 ──────────────────────────────────────────────
type Result = {
  aiScore: number;
  humanScore: number;
  verdict: "human" | "unclear" | "ai";
  label: string;
  reasons: string[];
  highlights: string[];
  language: "ja" | "en" | "mixed";
  languageWarning?: string;
  rewriteScore: number;
  rewriteTips: string[];
};

// ── 定数 ────────────────────────────────────────────────
const MIN_CHARS = 200;
const MAX_CHARS = 5000;

const VERDICT_STYLES = {
  human:   { bar: "bg-green-500",  badge: "bg-green-100  text-green-800  border-green-300  dark:bg-green-900  dark:text-green-200  dark:border-green-700",  icon: "✅" },
  unclear: { bar: "bg-yellow-400", badge: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700", icon: "⚠️" },
  ai:      { bar: "bg-red-500",    badge: "bg-red-100    text-red-800    border-red-300    dark:bg-red-900    dark:text-red-200    dark:border-red-700",    icon: "🤖" },
};

// ── カウントアップアニメーション ──────────────────────────
function useCountUp(target: number, duration = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let current = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      current += step;
      if (current >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(current));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

// ── ハイライトレンダラー ──────────────────────────────────
function HighlightedText({ text, highlights }: { text: string; highlights: string[] }) {
  if (!highlights.length) return <span>{text}</span>;
  const escaped = highlights.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        highlights.some((h) => h.toLowerCase() === part.toLowerCase()) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700 dark:text-yellow-100 rounded px-0.5">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ── スコアゲージ ─────────────────────────────────────────
function ScoreBar({ label, score, colorClass }: { label: string; score: number; colorClass: string }) {
  const animated = useCountUp(score);
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
        <span>{label}</span>
        <span className="font-semibold text-gray-800 dark:text-gray-200">{animated}%</span>
      </div>
      <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-700 ease-out ${colorClass}`}
          style={{ width: `${animated}%` }}
        />
      </div>
    </div>
  );
}

// ── ファイル読み込み ──────────────────────────────────────
async function extractTextFromFile(file: File): Promise<string> {
  // .txt
  if (file.type === "text/plain" || file.name.endsWith(".txt")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) ?? "");
      reader.onerror = reject;
      reader.readAsText(file, "UTF-8");
    });
  }

  // .pdf または .docx → サーバーAPIで抽出
  if (file.name.endsWith(".pdf") || file.name.endsWith(".docx")) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        resolve(result.split(",")[1]); // base64部分のみ
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const fileType = file.name.endsWith(".pdf") ? "pdf" : "docx";
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileBase64: base64, fileType }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "ファイルの読み込みに失敗しました");
    return data.text;
  }

  throw new Error(".txt / .pdf / .docx ファイルのみ対応しています");
}

// ── メインコンポーネント ──────────────────────────────────
export default function Home() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const charCount = text.length;
  const canSubmit = charCount >= MIN_CHARS && charCount <= MAX_CHARS && !loading;

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setExtracting(true);
    try {
      const extracted = await extractTextFromFile(file);
      setText(extracted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ファイルの読み込みに失敗しました");
    } finally {
      setExtracting(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleAnalyze = async () => {
    setError(null);
    setResult(null);
    setShowResult(false);
    setLoading(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "エラーが発生しました"); return; }
      setResult(data as Result);
      // 少し遅延させてアニメーションを発火
      setTimeout(() => setShowResult(true), 50);
    } catch {
      setError("ネットワークエラーが発生しました。再度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => { setText(""); setResult(null); setError(null); setShowResult(false); };

  const style = result ? VERDICT_STYLES[result.verdict] : null;

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 transition-colors duration-300">
        <Head>
          <title>AI文章チェッカー｜AIが書いたか無料で判定</title>
          <meta name="description" content="テキストを貼り付けるだけでAIが書いた文章かどうかを無料で判定。ChatGPT・Claude等のAI生成文章を瞬時に検出します。" />
          <meta name="keywords" content="AI文章判定,ChatGPT検出,AI生成チェック,AI文章チェッカー,無料" />
          <meta property="og:title" content="AI文章チェッカー｜AIが書いたか無料で判定" />
          <meta property="og:description" content="テキストを貼り付けるだけでAIが書いた文章かどうかを無料で判定。" />
          <meta property="og:type" content="website" />
          <meta name="twitter:card" content="summary" />
          <meta name="twitter:title" content="AI文章チェッカー｜AIが書いたか無料で判定" />
          <meta name="twitter:description" content="テキストを貼り付けるだけでAIが書いた文章かどうかを無料で判定。" />
          <link rel="canonical" href="https://ai-detector-plum.vercel.app" />
          <meta name="google-site-verification" content="LHsM05zq2_ySxflWm5ALpFfo_CTiilUHXuYzuApb500" />
        </Head>

        <div className="max-w-2xl mx-auto">
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-10">
            <div className="text-center flex-1">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">🔍 AI文章チェッカー</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm">テキストを貼り付けて、AIが書いたかどうかを判定します</p>
            </div>
            <button onClick={() => setDark(!dark)} className="p-2 rounded-lg text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition" aria-label="ダークモード切替">
              {dark ? "☀️" : "🌙"}
            </button>
          </div>

          {/* メインカード */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">

            {/* ファイルアップロード */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mb-4 border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition text-xs
                ${dragging ? "border-blue-400 bg-blue-50 dark:bg-blue-900/20" : "border-gray-200 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500"}`}
            >
              {extracting ? (
                <span className="text-blue-500 dark:text-blue-400">📂 ファイルを読み込んでいます...</span>
              ) : (
                <span className="text-gray-400 dark:text-gray-500">📎 .txt / .pdf / .docx をドラッグ＆ドロップ、またはクリックして選択</span>
              )}
              <input ref={fileInputRef} type="file" accept=".txt,.pdf,.docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>

            {/* テキストエリア */}
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">チェックしたいテキスト</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="ここにテキストを貼り付けてください..."
              rows={8}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-3 text-sm text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none transition"
            />

            {/* 文字数 */}
            <div className="flex justify-between items-center mt-2 mb-5">
              <span className={`text-xs ${charCount > MAX_CHARS ? "text-red-500" : charCount < MIN_CHARS ? "text-gray-400 dark:text-gray-500" : "text-green-600 dark:text-green-400"}`}>
                {charCount > MAX_CHARS ? `${MAX_CHARS.toLocaleString()}文字以内にしてください` : charCount < MIN_CHARS ? `あと ${MIN_CHARS - charCount} 文字以上入力してください` : `${charCount} 文字 ✓`}
              </span>
              <span className={`text-xs ${charCount > MAX_CHARS ? "text-red-500 font-semibold" : "text-gray-400 dark:text-gray-500"}`}>
                {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </span>
            </div>

            {/* ボタン */}
            <div className="flex gap-3">
              <button onClick={handleAnalyze} disabled={!canSubmit}
                className={`flex-1 py-3 rounded-lg font-semibold text-white text-sm transition ${canSubmit ? "bg-blue-600 hover:bg-blue-700 active:scale-95" : "bg-gray-300 dark:bg-gray-600 cursor-not-allowed"}`}>
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    判定中...
                  </span>
                ) : "判定する"}
              </button>
              {(result || error) && (
                <button onClick={handleReset} className="px-5 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                  リセット
                </button>
              )}
            </div>
            {loading && <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-3">初回は20〜30秒ほどかかることがあります</p>}
          </div>

          {/* エラー */}
          {error && (
            <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-4 text-red-700 dark:text-red-300 text-sm">❌ {error}</div>
          )}

          {/* 結果カード（フェードイン） */}
          {result && style && (
            <div className={`mt-6 transition-all duration-500 ${showResult ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-4">判定結果</h2>

                {result.languageWarning && (
                  <div className="mb-4 text-xs bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-2 text-yellow-700 dark:text-yellow-300">
                    🌐 {result.languageWarning}
                  </div>
                )}

                {/* 判定ラベル */}
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold mb-6 ${style.badge}`}>
                  <span>{style.icon}</span><span>{result.label}</span>
                </div>

                {/* スコアバー（アニメーション付き） */}
                <ScoreBar label="🤖 AI生成らしさ" score={result.aiScore} colorClass={style.bar} />
                <ScoreBar label="✍️ 人間らしさ" score={result.humanScore} colorClass="bg-green-400" />

                {/* ハイライト */}
                {result.highlights.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🖍️ AI的な表現（ハイライト）</h3>
                    <div className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded-lg p-3 leading-relaxed whitespace-pre-wrap break-words">
                      <HighlightedText text={text} highlights={result.highlights} />
                    </div>
                  </div>
                )}

                {/* 判定理由 */}
                {result.reasons.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">📋 判定の根拠</h3>
                    <ul className="space-y-2">
                      {result.reasons.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <span className="mt-0.5 text-blue-400 shrink-0">›</span><span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* コピペ対策スコア */}
                {result.rewriteScore > 0 && (
                  <div className="mb-6 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-orange-600 dark:text-orange-400 uppercase tracking-wide mb-3">✏️ コピペ対策スコア</h3>
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-orange-600 dark:text-orange-400 mb-1">
                        <span>書き直し推奨度</span>
                        <span className="font-bold">{result.rewriteScore}%</span>
                      </div>
                      <div className="w-full bg-orange-100 dark:bg-orange-900 rounded-full h-2">
                        <div className="h-2 rounded-full bg-orange-400 transition-all duration-700" style={{ width: `${result.rewriteScore}%` }} />
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {result.rewriteTips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-orange-700 dark:text-orange-300">
                          <span className="shrink-0 mt-0.5">→</span><span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                  ※ このツールは統計的な推定に基づいています。結果は参考値であり、100%の精度を保証するものではありません。
                </p>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-8">
            Powered by{" "}
            <a href="https://huggingface.co/openai-community/roberta-large-openai-detector" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">
              roberta-large-openai-detector
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
