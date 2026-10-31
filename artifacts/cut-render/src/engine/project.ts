import type { CutPlan, ProductType } from './types';
import { BOX_STYLES, defaultBoxParams, generateBoxPlan, type BoxParams, type BoxStyleId } from './packaging';
import { GARMENT_TEMPLATES, defaultGarmentParams, generateGarmentPlan, type GarmentId, type GarmentParams } from './apparel';
import { defaultPpfParams } from './ppf';

export interface ProductTypeInfo {
  id: ProductType;
  name: string;
  tagline: string;
  description: string;
}

export const PRODUCT_TYPES: ProductTypeInfo[] = [
  { id: 'apparel', name: 'Odevy', tagline: 'Strihové diely', description: 'Odstupňované strihy so švovými prídavkami, zárezmi a smerom osnovy, uložené na šírku látky.' },
  { id: 'packaging', name: 'Obaly', tagline: 'Výsekové a ohybové siete', description: 'Krabice a skladačky s rezmi, bigmi a lepiacimi plochami, ktoré sa naživo poskladajú v 3D.' },
  { id: 'ppf', name: 'Tvarované objekty', tagline: 'Strihy PPF fólie', description: 'Importujte ľubovoľný tvar, rozdeľte ho na fóliové diely, rozviňte ich do roviny a uložte na rolu.' },
];

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
}

/** Templates available for each product type ('imported' / samples for PPF). */
export function getTemplatesFor(productType: ProductType): TemplateOption[] {
  if (productType === 'packaging') return BOX_STYLES.map((s) => ({ id: s.id, name: s.name + ' · ' + s.code, description: s.description }));
  if (productType === 'apparel') return GARMENT_TEMPLATES.map((g) => ({ id: g.id, name: g.name, description: g.description }));
  return [{ id: 'imported', name: 'Importovaný model', description: 'Vlastný súbor STEP, IGES, STL, OBJ, GLB, FBX a ďalšie.' }];
}

/** Default parameters for a new project. */
export function defaultParametersFor(productType: ProductType, template: string): Record<string, unknown> {
  if (productType === 'packaging') return { ...defaultBoxParams(template as BoxStyleId) };
  if (productType === 'apparel') return { ...defaultGarmentParams(template as GarmentId) };
  return { ...defaultPpfParams() };
}

/** Synchronous plan generation for parametric products (apparel, packaging). PPF uses generatePpfPlan. */
export function generateParametricPlan(productType: 'apparel' | 'packaging', parameters: Record<string, unknown>): CutPlan {
  if (productType === 'packaging') return generateBoxPlan(parameters as unknown as BoxParams);
  return generateGarmentPlan(parameters as unknown as GarmentParams);
}
