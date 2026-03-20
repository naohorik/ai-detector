import { useState } from "react";
import Head from "next/head";

// ── 型定義 ──────────────────────────────────────────────
type Result = {
  aiScore: number;
  humanScore: number;
  verdict: "human" | "unclear" | "ai";
  label: string;
};

// ── 定数 ────────────────────────────────────────────────
const MIN_CHARS = 200;
const MAX_CHARS = 5000;

// スコアに応じたスタイルを返す
const VERDICT_STYLES = {
  human: {
    bar: "bg-green-500",
    badge: "bg-green-100 text-green-800 border-green-300",
    icon: "✅",
  },
  unclear: {
    bar: "bg-yellow-400",
    badge: "bg-yellow-100 text-yellow-800 border-yellow-300",
    icon: "⚠️",
  },
  ai: {
    bar: "bg-red-500",
    badge: "bg-red-100 text-red-800 border-red-300",
    icon: "🤖",
  },
};

// ── コンポーネント ────────────────────────────────────────
export default function Home() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charCount = text.length;
  const canSubmit = charCount >= MIN_CHARS && charCount <= MAX_CHARS && !loading;

  // 判定APIを呼び出す
  const handleAnalyze = async () => {
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "エラーが発生しました");
        return;
      }

      setResult(data as Result);
    } catch {
      setError("ネットワークエラーが発生しました。再度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  // リセット
  const handleReset = () => {
    setText("");
    setResult(null);
    setError(null);
  };

  const style = result ? VERDICT_STYLES[result.verdict] : null;

  return (
    <>
    <Head>
      <title>AI文章チェッカー｜AIが書いたか無料で判定</title>
      <meta name="description" content="テキストを貼り付けるだけでAIが書いた文章かどうかを無料で判定。ChatGPT・Claude等のAI生成文章を瞬時に検出します。" />
      <meta name="keywords" content="AI文章判定,ChatGPT検出,AI生成チェック,AI文章チェッカー,無料" />
      <meta property="og:title" content="AI文章チェッカー｜AIが書いたか無料で判定" />
      <meta property="og:description" content="テキストを貼り付けるだけでAIが書いた文章かどうかを無料で判定。ChatGPT・Claude等のAI生成文章を検出します。" />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content="AI文章チェッカー｜AIが書いたか無料で判定" />
      <meta name="twitter:description" content="テキストを貼り付けるだけでAIが書いた文章かどうかを無料で判定。" />
      <link rel="canonical" href="https://あなたのドメイン.vercel.app" />
    </Head>
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">

        {/* ヘッダー */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🔍 AI文章チェッカー
          </h1>
          <p className="text-gray-500 text-sm">
            テキストを貼り付けて、AIが書いたかどうかを判定します
          </p>
        </div>

        {/* メインカード */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">

          {/* テキストエリア */}
          <label className="block text-sm font-medium text-gray-700 mb-2">
            チェックしたいテキスト
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="ここにテキストを貼り付けてください..."
            rows={8}
            className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-800
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                       resize-none transition"
          />

          {/* 文字数カウント */}
          <div className="flex justify-between items-center mt-2 mb-5">
            <span
              className={`text-xs ${
                charCount > MAX_CHARS
                  ? "text-red-500"
                  : charCount < MIN_CHARS
                  ? "text-gray-400"
                  : "text-green-600"
              }`}
            >
              {charCount > MAX_CHARS
                ? `${MAX_CHARS.toLocaleString()}文字以内にしてください（超過: ${charCount - MAX_CHARS}文字）`
                : charCount < MIN_CHARS
                ? `あと ${MIN_CHARS - charCount} 文字以上入力してください`
                : `${charCount} 文字 ✓`}
            </span>
            <span className={`text-xs ${charCount > MAX_CHARS ? "text-red-500 font-semibold" : "text-gray-400"}`}>
              {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
            </span>
          </div>

          {/* ボタン群 */}
          <div className="flex gap-3">
            <button
              onClick={handleAnalyze}
              disabled={!canSubmit}
              className={`flex-1 py-3 rounded-lg font-semibold text-white text-sm transition
                ${
                  canSubmit
                    ? "bg-blue-600 hover:bg-blue-700 active:scale-95"
                    : "bg-gray-300 cursor-not-allowed"
                }`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8z"
                    />
                  </svg>
                  判定中...
                </span>
              ) : (
                "判定する"
              )}
            </button>

            {(result || error) && (
              <button
                onClick={handleReset}
                className="px-5 py-3 rounded-lg border border-gray-300 text-gray-600
                           text-sm font-medium hover:bg-gray-50 transition"
              >
                リセット
              </button>
            )}
          </div>

          {/* モデル起動中のヒント */}
          {loading && (
            <p className="text-xs text-gray-400 text-center mt-3">
              初回は20〜30秒ほどかかることがあります
            </p>
          )}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            ❌ {error}
          </div>
        )}

        {/* 結果表示 */}
        {result && style && (
          <div className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              判定結果
            </h2>

            {/* 判定ラベル */}
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm font-semibold mb-6 ${style.badge}`}
            >
              <span>{style.icon}</span>
              <span>{result.label}</span>
            </div>

            {/* スコアバー（AI生成） */}
            <div className="mb-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>🤖 AI生成らしさ</span>
                <span className="font-semibold text-gray-800">
                  {result.aiScore}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-3 rounded-full transition-all duration-700 ${style.bar}`}
                  style={{ width: `${result.aiScore}%` }}
                />
              </div>
            </div>

            {/* スコアバー（人間） */}
            <div className="mb-6">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>✍️ 人間らしさ</span>
                <span className="font-semibold text-gray-800">
                  {result.humanScore}%
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div
                  className="h-3 rounded-full bg-green-400 transition-all duration-700"
                  style={{ width: `${result.humanScore}%` }}
                />
              </div>
            </div>

            {/* 注意書き */}
            <p className="text-xs text-gray-400 leading-relaxed">
              ※ このツールは統計的な推定に基づいています。結果は参考値であり、
              100%の精度を保証するものではありません。
            </p>
          </div>
        )}

        {/* フッター */}
        <p className="text-center text-xs text-gray-400 mt-8">
          Powered by{" "}
          <a
            href="https://huggingface.co/roberta-base-openai-detector"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-600"
          >
            roberta-base-openai-detector
          </a>
        </p>
      </div>
    </div>
    </>
  );
}
