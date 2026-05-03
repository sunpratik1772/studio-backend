import { Router } from "express";
import { randomUUID } from "node:crypto";
import { FanOutTasksBody } from "@workspace/api-zod";

const router = Router();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

router.post("/tasks/fan-out", async (req, res, next) => {
  try {
    const parsed = FanOutTasksBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { task_count, mock_duration_ms } = parsed.data;
    const wallStart = Date.now();
    const startedAt = new Date(wallStart).toISOString();

    req.log.info(
      { task_count, mock_duration_ms },
      "fan-out: spawning concurrent tasks via Promise.all",
    );

    // True N-ary parallel execution. Promise.all schedules all promises in the
    // same microtask, so every setTimeout is registered ~simultaneously.
    const tasks = await Promise.all(
      Array.from({ length: task_count }, (_, index) => {
        const taskId = randomUUID();
        const tStart = Date.now();
        return sleep(mock_duration_ms).then(() => {
          const tEnd = Date.now();
          return {
            taskId,
            index,
            status: "completed" as const,
            startedAt: new Date(tStart).toISOString(),
            completedAt: new Date(tEnd).toISOString(),
            durationMs: tEnd - tStart,
            result: `Task ${index} done after ${tEnd - tStart}ms`,
          };
        });
      }),
    );

    const wallEnd = Date.now();
    const totalDurationMs = wallEnd - wallStart;
    const starts = tasks.map((t) => new Date(t.startedAt).getTime());
    const startSpreadMs = Math.max(...starts) - Math.min(...starts);
    const speedupFactor =
      totalDurationMs > 0 ? (mock_duration_ms * task_count) / totalDurationMs : 0;

    req.log.info(
      { task_count, mock_duration_ms, totalDurationMs, startSpreadMs, speedupFactor },
      "fan-out: all tasks complete",
    );

    res.json({
      taskCount: task_count,
      mockDurationMs: mock_duration_ms,
      startedAt,
      completedAt: new Date(wallEnd).toISOString(),
      totalDurationMs,
      startSpreadMs,
      speedupFactor: Math.round(speedupFactor * 100) / 100,
      tasks,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
