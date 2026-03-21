import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
};

type SuccessResponse = { text: string };
type ErrorResponse = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const { fileBase64, fileType } = req.body;
  if (!fileBase64 || !fileType) return res.status(400).json({ error: "ファイルデータが不正です" });

  const buffer = Buffer.from(fileBase64, "base64");

  try {
    if (fileType === "pdf") {
      // pdf-parse の Next.js 対策：直接ライブラリパスを指定
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse/lib/pdf-parse.js");
      const data = await pdfParse(buffer);
      return res.status(200).json({ text: data.text });
    }

    if (fileType === "docx") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return res.status(200).json({ text: result.value });
    }

    return res.status(400).json({ error: "未対応のファイル形式です" });
  } catch (err) {
    console.error("Extract error:", err);
    return res.status(500).json({ error: "ファイルの読み込みに失敗しました" });
  }
}
