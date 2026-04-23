import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { getPortfolioSummary } from "../services/deals";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireRole("gp"));

dashboardRouter.get("/summary", async (_req, res) => {
  res.json(await getPortfolioSummary());
});
