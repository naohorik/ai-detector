import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const config = {
  runtime: "edge",
};

export default function handler(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const score = Number(searchParams.get("score") ?? 50);
  const verdict = searchParams.get("verdict") ?? "unclear";

  const verdictConfig: Record<string, { emoji: string; label: string; color: string; bg: string }> = {
    ai:      { emoji: "🤖", label: "AIが書いた可能性が高い", color: "#ef4444", bg: "#fef2f2" },
    human:   { emoji: "✅", label: "人間が書いた可能性が高い", color: "#22c55e", bg: "#f0fdf4" },
    unclear: { emoji: "⚠️", label: "判断が難しい",            color: "#eab308", bg: "#fefce8" },
  };

  const cfg = verdictConfig[verdict] ?? verdictConfig.unclear;
  const humanScore = 100 - score;

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f8fafc",
          fontFamily: "sans-serif",
          padding: "60px",
        }}
      >
        {/* タイトル */}
        <div style={{ fontSize: "36px", fontWeight: "700", color: "#1e293b", marginBottom: "8px" }}>
          🔍 AI文章チェッカー
        </div>
        <div style={{ fontSize: "18px", color: "#64748b", marginBottom: "48px" }}>
          ai-detector-plum.vercel.app
        </div>

        {/* 判定バッジ */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            backgroundColor: cfg.bg,
            border: `2px solid ${cfg.color}`,
            borderRadius: "50px",
            padding: "16px 40px",
            marginBottom: "48px",
          }}
        >
          <span style={{ fontSize: "48px" }}>{cfg.emoji}</span>
          <span style={{ fontSize: "32px", fontWeight: "700", color: cfg.color }}>{cfg.label}</span>
        </div>

        {/* スコア表示 */}
        <div style={{ display: "flex", gap: "48px", marginBottom: "36px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "64px", fontWeight: "800", color: "#ef4444" }}>{score}%</div>
            <div style={{ fontSize: "16px", color: "#64748b" }}>🤖 AI生成らしさ</div>
          </div>
          <div style={{ width: "2px", backgroundColor: "#e2e8f0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "64px", fontWeight: "800", color: "#22c55e" }}>{humanScore}%</div>
            <div style={{ fontSize: "16px", color: "#64748b" }}>✍️ 人間らしさ</div>
          </div>
        </div>

        {/* スコアバー */}
        <div style={{ width: "700px", height: "20px", backgroundColor: "#e2e8f0", borderRadius: "10px", overflow: "hidden" }}>
          <div
            style={{
              width: `${score}%`,
              height: "20px",
              backgroundColor: score >= 70 ? "#ef4444" : score >= 31 ? "#eab308" : "#22c55e",
              borderRadius: "10px",
            }}
          />
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
