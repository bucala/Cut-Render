import { pgTable, serial, text, jsonb, integer, timestamp, index } from "drizzle-orm/pg-core";

export type PlanStatsJson = {
  pieceCount: number;
  totalAreaMm2: number;
  cutLengthMm: number;
  foldLengthMm: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  utilization: number;
};

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  productType: text("product_type").notNull().$type<"apparel" | "packaging" | "ppf">(),
  template: text("template").notNull(),
  materialId: text("material_id").notNull(),
  parameters: jsonb("parameters").notNull().$type<Record<string, unknown>>().default({}),
  renderSettings: jsonb("render_settings").notNull().$type<Record<string, unknown>>().default({}),
  modelFileName: text("model_file_name"),
  modelFormat: text("model_format"),
  planStats: jsonb("plan_stats").$type<PlanStatsJson | null>(),
  plan: jsonb("plan").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectExportsTable = pgTable(
  "project_exports",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projectsTable.id, { onDelete: "cascade" }),
    format: text("format").notNull().$type<"svg" | "dxf" | "pdf" | "png" | "json">(),
    fileName: text("file_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_exports_project_idx").on(t.projectId)],
);

export const activityTable = pgTable("activity", {
  id: serial("id").primaryKey(),
  /** Nullable so activity survives project deletion */
  projectId: integer("project_id"),
  projectName: text("project_name").notNull(),
  productType: text("product_type").notNull().$type<"apparel" | "packaging" | "ppf">(),
  kind: text("kind").notNull().$type<"created" | "updated" | "exported" | "duplicated" | "deleted">(),
  detail: text("detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Project = typeof projectsTable.$inferSelect;
export type ProjectExport = typeof projectExportsTable.$inferSelect;
export type Activity = typeof activityTable.$inferSelect;
