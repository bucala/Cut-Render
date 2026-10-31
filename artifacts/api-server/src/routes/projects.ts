import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  projectsTable,
  projectExportsTable,
  activityTable,
  type Project,
} from "@workspace/db";
import {
  ListProjectsQueryParams,
  ListProjectsResponse,
  CreateProjectBody,
  GetProjectParams,
  GetProjectResponse,
  UpdateProjectParams,
  UpdateProjectBody,
  UpdateProjectResponse,
  DeleteProjectParams,
  DuplicateProjectParams,
  ListProjectExportsParams,
  ListProjectExportsResponse,
  RecordProjectExportParams,
  RecordProjectExportBody,
  GetProjectsSummaryResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

type ActivityKind = "created" | "updated" | "exported" | "duplicated" | "deleted";

async function logActivity(p: Pick<Project, "id" | "name" | "productType">, kind: ActivityKind, detail: string) {
  await db.insert(activityTable).values({
    projectId: kind === "deleted" ? null : p.id,
    projectName: p.name,
    productType: p.productType,
    kind,
    detail,
  });
}

async function exportCounts(ids: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ projectId: projectExportsTable.projectId, n: count() })
    .from(projectExportsTable)
    .where(inArray(projectExportsTable.projectId, ids))
    .groupBy(projectExportsTable.projectId);
  for (const r of rows) map.set(r.projectId, Number(r.n));
  return map;
}

function toFull(p: Project, exportCount: number) {
  return { ...p, exportCount };
}

function toSummary(p: Project, exportCount: number) {
  const { parameters: _p, renderSettings: _r, plan: _plan, ...rest } = p;
  return { ...rest, exportCount };
}

function badRequest(res: Response, error: unknown) {
  res.status(400).json({ error: "Invalid request", details: String(error) });
}

router.get("/projects", async (req: Request, res: Response) => {
  const q = ListProjectsQueryParams.safeParse(req.query);
  if (!q.success) return badRequest(res, q.error);
  const rows = await db
    .select()
    .from(projectsTable)
    .where(q.data.productType ? eq(projectsTable.productType, q.data.productType) : undefined)
    .orderBy(desc(projectsTable.updatedAt));
  const counts = await exportCounts(rows.map((r) => r.id));
  res.json(ListProjectsResponse.parse(rows.map((r) => toSummary(r, counts.get(r.id) ?? 0))));
});

router.post("/projects", async (req: Request, res: Response) => {
  const body = CreateProjectBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const [p] = await db
    .insert(projectsTable)
    .values({
      name: body.data.name,
      productType: body.data.productType,
      template: body.data.template,
      materialId: body.data.materialId,
      parameters: body.data.parameters ?? {},
      renderSettings: body.data.renderSettings ?? {},
      modelFileName: body.data.modelFileName ?? null,
      modelFormat: body.data.modelFormat ?? null,
    })
    .returning();
  await logActivity(p, "created", body.data.modelFileName ? `Importovaný súbor ${body.data.modelFileName}` : `Šablóna ${p.template}`);
  res.status(201).json(GetProjectResponse.parse(toFull(p, 0)));
});

router.get("/projects/summary", async (_req: Request, res: Response) => {
  const rows = await db
    .select({ productType: projectsTable.productType, planStats: projectsTable.planStats })
    .from(projectsTable);
  const byType = { apparel: 0, packaging: 0, ppf: 0 };
  let totalPieces = 0;
  let totalCutLengthMm = 0;
  let totalAreaMm2 = 0;
  for (const r of rows) {
    byType[r.productType] += 1;
    if (r.planStats) {
      totalPieces += r.planStats.pieceCount;
      totalCutLengthMm += r.planStats.cutLengthMm;
      totalAreaMm2 += r.planStats.totalAreaMm2;
    }
  }
  const fmt = await db
    .select({ format: projectExportsTable.format, n: count() })
    .from(projectExportsTable)
    .groupBy(projectExportsTable.format);
  const exportsByFormat: Record<string, number> = {};
  let totalExports = 0;
  for (const f of fmt) {
    exportsByFormat[f.format] = Number(f.n);
    totalExports += Number(f.n);
  }
  res.json(
    GetProjectsSummaryResponse.parse({
      totalProjects: rows.length,
      byType,
      totalPieces,
      totalCutLengthMm,
      totalAreaMm2,
      totalExports,
      exportsByFormat,
    }),
  );
});

router.get("/projects/:id", async (req: Request, res: Response) => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error);
  const [p] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!p) return res.status(404).json({ error: "Project not found" });
  const counts = await exportCounts([p.id]);
  res.json(GetProjectResponse.parse(toFull(p, counts.get(p.id) ?? 0)));
});

router.patch("/projects/:id", async (req: Request, res: Response) => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error);
  const body = UpdateProjectBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const [existing] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Project not found" });

  const patch: Partial<Project> = { updatedAt: new Date() };
  const d = body.data;
  if (d.name !== undefined) patch.name = d.name;
  if (d.template !== undefined) patch.template = d.template;
  if (d.materialId !== undefined) patch.materialId = d.materialId;
  if (d.parameters !== undefined) patch.parameters = d.parameters;
  if (d.renderSettings !== undefined) patch.renderSettings = d.renderSettings;
  if (d.modelFileName !== undefined) patch.modelFileName = d.modelFileName;
  if (d.modelFormat !== undefined) patch.modelFormat = d.modelFormat;
  if (d.planStats !== undefined) patch.planStats = d.planStats;
  if (d.plan !== undefined) patch.plan = d.plan;

  const [p] = await db.update(projectsTable).set(patch).where(eq(projectsTable.id, existing.id)).returning();

  // Log meaningful edits only, at most once per 10 minutes per project, so autosave does not flood the feed.
  const meaningful = d.name !== undefined || d.template !== undefined || d.materialId !== undefined || d.parameters !== undefined || d.modelFileName !== undefined;
  if (meaningful) {
    const [recent] = await db
      .select({ id: activityTable.id })
      .from(activityTable)
      .where(
        and(
          eq(activityTable.projectId, p.id),
          eq(activityTable.kind, "updated"),
          sql`${activityTable.createdAt} > now() - interval '10 minutes'`,
        ),
      )
      .limit(1);
    if (!recent) {
      const what: string[] = [];
      if (d.name !== undefined && d.name !== existing.name) what.push("názov");
      if (d.materialId !== undefined && d.materialId !== existing.materialId) what.push("materiál");
      if (d.parameters !== undefined) what.push("parametre");
      if (d.template !== undefined && d.template !== existing.template) what.push("šablóna");
      if (d.modelFileName !== undefined) what.push("model");
      if (what.length) await logActivity(p, "updated", `Zmenené: ${what.join(", ")}`);
    }
  }
  const counts = await exportCounts([p.id]);
  res.json(UpdateProjectResponse.parse(toFull(p, counts.get(p.id) ?? 0)));
});

router.delete("/projects/:id", async (req: Request, res: Response) => {
  const params = DeleteProjectParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error);
  const [p] = await db.delete(projectsTable).where(eq(projectsTable.id, params.data.id)).returning();
  if (!p) return res.status(404).json({ error: "Project not found" });
  await db.update(activityTable).set({ projectId: null }).where(eq(activityTable.projectId, p.id));
  await logActivity(p, "deleted", "Projekt zmazaný");
  res.status(204).end();
});

router.post("/projects/:id/duplicate", async (req: Request, res: Response) => {
  const params = DuplicateProjectParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error);
  const [src] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!src) return res.status(404).json({ error: "Project not found" });
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
  const [p] = await db
    .insert(projectsTable)
    .values({ ...rest, name: `${src.name} (kópia)` })
    .returning();
  await logActivity(p, "duplicated", `Kópia projektu ${src.name}`);
  res.status(201).json(GetProjectResponse.parse(toFull(p, 0)));
});

router.get("/projects/:id/exports", async (req: Request, res: Response) => {
  const params = ListProjectExportsParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error);
  const rows = await db
    .select()
    .from(projectExportsTable)
    .where(eq(projectExportsTable.projectId, params.data.id))
    .orderBy(desc(projectExportsTable.createdAt));
  res.json(ListProjectExportsResponse.parse(rows));
});

router.post("/projects/:id/exports", async (req: Request, res: Response) => {
  const params = RecordProjectExportParams.safeParse(req.params);
  if (!params.success) return badRequest(res, params.error);
  const body = RecordProjectExportBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const [p] = await db.select().from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!p) return res.status(404).json({ error: "Project not found" });
  const [e] = await db
    .insert(projectExportsTable)
    .values({ projectId: p.id, format: body.data.format, fileName: body.data.fileName })
    .returning();
  await logActivity(p, "exported", `${body.data.format.toUpperCase()} · ${body.data.fileName}`);
  res.status(201).json(e);
});

router.get("/activity/recent", async (req: Request, res: Response) => {
  const q = GetRecentActivityQueryParams.safeParse(req.query);
  if (!q.success) return badRequest(res, q.error);
  const rows = await db
    .select()
    .from(activityTable)
    .orderBy(desc(activityTable.createdAt))
    .limit(q.data.limit ?? 20);
  res.json(GetRecentActivityResponse.parse(rows));
});

export default router;
