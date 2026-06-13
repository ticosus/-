import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const GEMINI_KEY = process.env.GEMINI_API_KEY;

function calculateIndicators(closes) {
  if (closes.length < 26) return { rsi: 50, macd: 0, ma5: closes.at(-1), ma20: closes.at(-1) };
  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;

  let changeSum = 0, gainSum = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gainSum += diff;
    changeSum += Math.abs(diff);
  }
  const rsi = changeSum === 0 ? 50 : (gainSum / changeSum) * 100;

  const ema12 = closes.slice(-12).reduce((a, b) => a + b, 0) / 12;
  const ema26 = closes.slice(-26).reduce((a, b) => a + b, 0) / 26;
  const macd = ema12 - ema26;

  return { rsi, macd, ma5, ma20 };
}

async function askGemini(prompt) {
  if (!GEMINI_KEY) throw new Error("尚未設定 GEMINI_API_KEY");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            bias: { type: "STRING" },
            reason: { type: "STRING" },
            support: { type: "NUMBER" },
            resistance: { type: "NUMBER" },
            risk: { type: "STRING" }
          },
          required: ["bias", "reason", "support", "resistance", "risk"]
       }
      }
    })
  });
  const j = await response.json();
  return JSON.parse(j.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

app.get("/api/stock/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const formattedCode = code.includes(".") ? code : `${code}.TW`;
    const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${formattedCode}?range=3mo&interval=1d`;
    const yfRes = await fetch(yfUrl);
    const yfData = await yfRes.json();
    const closes = yfData.chart?.result?.[0]?.indicators?.quote[0]?.close.filter(Boolean);
    if (!closes || closes.length < 26) throw new Error("歷史資料不足或代碼錯誤");
    const last = closes.at(-1);
    const ind = calculateIndicators(closes);
    const prompt = `你是台股分析師。請根據數據分析 ${formattedCode}：收盤價:${last}, RSI:${ind.rsi.toFixed(2)}, MACD:${ind.macd.toFixed(2)}, MA5:${ind.ma5.toFixed(2)}, MA20:${ind.ma20.toFixed(2)}。請嚴格用 JSON 回覆。`;
    const aiJson = await askGemini(prompt);
    res.json({ success: true, last, ...ind, ai: aiJson });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
