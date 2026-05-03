import { Router, type IRouter } from "express";
import healthRouter from "./health";
import agentsRouter from "./agents";
import runnerRouter from "./runner";
import skillsRouter from "./skills";
import logsRouter from "./logs";
import webhooksRouter from "./webhooks";
import metricsRouter from "./metrics";
import tasksRouter from "./tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(runnerRouter);
router.use(agentsRouter);
router.use(skillsRouter);
router.use(logsRouter);
router.use(webhooksRouter);
router.use(metricsRouter);
router.use(tasksRouter);

export default router;
