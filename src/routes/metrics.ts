import { Router } from "express";
import { GetTokenMetricsQueryParams } from "@workspace/api-zod";

const router = Router();

function generateDataPoints(period: string) {
  const now = Date.now();
  const periodMap: Record<string, { count: number; intervalMs: number }> = {
    "1h": { count: 12, intervalMs: 5 * 60 * 1000 },
    "6h": { count: 24, intervalMs: 15 * 60 * 1000 },
    "24h": { count: 24, intervalMs: 60 * 60 * 1000 },
    "7d": { count: 28, intervalMs: 6 * 60 * 60 * 1000 },
  };
  const { count, intervalMs } = periodMap[period] ?? periodMap["24h"];

  return Array.from({ length: count }, (_, i) => {
    const ts = new Date(now - (count - 1 - i) * intervalMs);
    const prompt = Math.floor(Math.random() * 2000) + 500;
    const completion = Math.floor(Math.random() * 1000) + 200;
    return {
      timestamp: ts.toISOString(),
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
    };
  });
}

router.get("/metrics/tokens", async (req, res) => {
  const parsed = GetTokenMetricsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { period } = parsed.data;
  const dataPoints = generateDataPoints(period);
  const totalTokens = dataPoints.reduce((acc, d) => acc + d.totalTokens, 0);
  const promptTokens = dataPoints.reduce((acc, d) => acc + d.promptTokens, 0);
  const completionTokens = dataPoints.reduce((acc, d) => acc + d.completionTokens, 0);

  res.json({
    period,
    dataPoints,
    totalTokens,
    promptTokens,
    completionTokens,
    estimatedCostUsd: parseFloat((totalTokens * 0.000003).toFixed(4)),
  });
});

export default router;
