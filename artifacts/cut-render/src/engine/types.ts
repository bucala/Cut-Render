/**
 * Core data types shared by the Cut & Render engine.
 * All plan geometry is in millimetres, y axis pointing down (SVG convention).
 */

export type ProductType = 'apparel' | 'packaging' | 'ppf';

export interface Point {
  x: number;
  y: number;
}

/**
 * Line kinds used in a production plan.
 * - cut: knife / scissors line (outer outline)
 * - fold: fold line (packaging hinge, crease that is folded)
 * - crease: partial-depth crease (score) that is not necessarily folded 90deg
 * - perforation: perforated line
 * - seam: stitching line (garment, seam allowance inside the cut line)
 * - grain: grain-line arrow (garment)
 * - notch: alignment notch marks
 * - bleed: print bleed outline
 * - glue: glue area outline
 * - relief: relief cut / dart line (PPF, garment darts)
 * - annotation: non-production helper line
 */
export type LineKind =
  | 'cut'
  | 'fold'
  | 'crease'
  | 'perforation'
  | 'seam'
  | 'grain'
  | 'notch'
  | 'bleed'
  | 'glue'
  | 'relief'
  | 'annotation';

export interface PlanPath {
  id: string;
  kind: LineKind;
  points: Point[];
  closed: boolean;
}

export interface PlanLabel {
  text: string;
  position: Point;
  /** font size in mm */
  size: number;
  /** rotation in degrees */
  rotation?: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlanPiece {
  id: string;
  name: string;
  /** How many times this piece must be cut (paths are drawn once per instance already placed on the sheet). */
  quantity: number;
  /** Display colour (hex) used to tint the piece in 2D and to highlight its region in 3D. */
  color: string;
  /** Paths are already positioned in sheet coordinates (mm). */
  paths: PlanPath[];
  labels: PlanLabel[];
  bounds: Bounds;
  areaMm2: number;
  cutLengthMm: number;
  foldLengthMm: number;
  /** Extra per-piece information shown in the UI, e.g. { 'Max stretch': '4.2 %' }. */
  meta: Record<string, string | number>;
  /**
   * Printable garment panel carried by this piece. `matrix` maps the panel's
   * drafting frame (mm) to sheet coordinates: x' = a x + c y + e, y' = b x + d y + f.
   */
  print?: { panel: string; matrix: [number, number, number, number, number, number] };
}

export interface PlanStats {
  pieceCount: number;
  totalAreaMm2: number;
  cutLengthMm: number;
  foldLengthMm: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** 0..1 share of the sheet covered by pieces */
  utilization: number;
}

export interface CutPlan {
  productType: ProductType;
  title: string;
  units: 'mm';
  /** The sheet / fabric marker / film roll area the pieces are laid out on. */
  sheet: { width: number; height: number; label: string };
  pieces: PlanPiece[];
  stats: PlanStats;
  /** Line kinds present in the plan (for building a legend). */
  legend: LineKind[];
  /** Human readable warnings (e.g. high stretch, piece wider than roll). */
  warnings: string[];
}

/** Visual style for each line kind in 2D views and exports. */
export interface LineStyle {
  label: string;
  color: string;
  /** stroke width in mm at 1:1 */
  width: number;
  /** SVG dash array in mm, empty for solid */
  dash: number[];
  /** DXF layer name */
  layer: string;
  /** DXF colour index (ACI) */
  aci: number;
}

export interface ProgressInfo {
  stage: string;
  /** 0..1 */
  progress: number;
}

export type ProgressCallback = (info: ProgressInfo) => void;
