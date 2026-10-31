import { formatDistanceToNow, format } from 'date-fns';
import { sk } from 'date-fns/locale';
import type { ProductType, LineKind } from '@/engine';

export const PRODUCT_SK: Record<ProductType, { name: string; tagline: string; description: string; code: string }> = {
  apparel: { name: 'Odevy', tagline: 'Strihové diely', code: 'A', description: 'Odstupňované strihy so švovými prídavkami, zárezmi a smerom osnovy, uložené na šírku látky.' },
  packaging: { name: 'Obaly', tagline: 'Výsekové a ohybové siete', code: 'P', description: 'Krabice a skladačky s rezmi, bigmi a lepiacimi plochami, ktoré sa naživo poskladajú v 3D.' },
  ppf: { name: 'Tvarované objekty', tagline: 'Strihy PPF fólie', code: 'F', description: 'Importujte ľubovoľný tvar, rozdeľte ho na fóliové diely, rozviňte ich do roviny a uložte na rolu.' },
};

export const LINE_SK: Record<LineKind, string> = {
  cut: 'Rez', fold: 'Ohyb', crease: 'Bigovanie', perforation: 'Perforácia', seam: 'Šev', grain: 'Smer osnovy',
  notch: 'Zárez', bleed: 'Spadávka', glue: 'Lepiaca plocha', relief: 'Odľahčovací rez', annotation: 'Poznámka',
};

export const ENV_SK: Record<string, { label: string; description: string }> = {
  studio: { label: 'Fotoštúdio', description: 'Neutrálne štúdio s veľkými softboxmi.' },
  softbox: { label: 'Produktový softbox', description: 'Jasné rovnomerné svetlo pre obaly.' },
  workshop: { label: 'Dielňa', description: 'Teplé interiérové svetlo s odleskami okien.' },
  sunset: { label: 'Zlatá hodinka', description: 'Nízke teplé slnko, dlhé odrazy na laku a fólii.' },
  night: { label: 'Nočný showroom', description: 'Tmavá miestnosť s dramatickými pásovými svetlami.' },
};

export const TEMPLATE_SK: Record<string, { name: string; description: string }> = {
  rsc: { name: 'Klopová krabica · FEFCO 0201', description: 'Štandardná prepravná krabica: štyri steny, lepiaca chlopňa a štyri klopy hore aj dole.' },
  'tuck-end': { name: 'Skladačka s protiľahlými zásuvkami · ECMA A20.20', description: 'Retailová skladačka so zasúvacími chlopňami na opačných stranách.' },
  mailer: { name: 'Poštová krabica · FEFCO 0427', description: 'Výsekový e-shop obal s vekom na pánte a prednou zásuvkou.' },
  tray: { name: 'Otvorený podnos · FEFCO 0300', description: 'Jednoduchý displejový podnos so zámkovými rohmi.' },
  tshirt: { name: 'Tričko', description: 'Tričko s okrúhlym výstrihom a všitým rukávom.' },
  hoodie: { name: 'Mikina s kapucňou', description: 'Pretiahnutá mikina s dvojdielnou kapucňou a klokaním vreckom.' },
  trousers: { name: 'Nohavice', description: 'Rovné nohavice s pásom.' },
  skirt: { name: 'Áčková sukňa', description: 'Rozšírená sukňa do A s pásom.' },
  tote: { name: 'Taška tote', description: 'Taška s tvarovaným dnom a uchami.' },
  imported: { name: 'Importovaný model', description: 'Vlastný súbor STEP, IGES, STL, OBJ, GLB, FBX a ďalšie.' },
};

export const SAMPLE_SK: Record<string, { name: string; description: string }> = {
  hood: { name: 'Kapota auta', description: 'Veľký dvojito zakrivený karosársky diel.' },
  mirror: { name: 'Kryt spätného zrkadla', description: 'Malý, hlboko zakrivený diel — klasická výzva pre PPF.' },
  phone: { name: 'Telo telefónu', description: 'Škrupina so zaoblenými rohmi.' },
  helmet: { name: 'Škrupina prilby', description: 'Kupola s výrezom pre priezor.' },
};

export const PAINT_SK: Record<string, string> = {
  'arctic-white': 'Arktická biela', obsidian: 'Obsidián metalíza', 'racing-red': 'Pretekárska červená', 'nardo-grey': 'Nardo sivá',
  'british-green': 'Britská pretekárska zelená', 'liquid-silver': 'Tekuté striebro', 'miami-blue': 'Miami modrá',
};

export const CATEGORY_SK: Record<string, string> = {
  'Natural fibres': 'Prírodné vlákna', Luxury: 'Luxusné', Synthetics: 'Syntetika', Corrugated: 'Vlnitá lepenka',
  'Folding carton': 'Skladačková lepenka', Finishes: 'Povrchové úpravy', 'Clear film': 'Číra fólia', 'Colour film': 'Farebná fólia',
};

export const PROP_SK: Record<string, string> = {
  Weight: 'Gramáž', Stretch: 'Pružnosť', Width: 'Šírka', Thickness: 'Hrúbka', 'Hide size': 'Veľkosť kože', Caliper: 'Hrúbka',
  ECT: 'ECT', Grammage: 'Gramáž', Coating: 'Náter', Lamination: 'Laminácia', Gloss: 'Lesk', Film: 'Fólia', Elongation: 'Predĺženie', 'Roll width': 'Šírka role',
};

export function propValue(v: string) {
  return v.replace('across', 'priečne').replace('in use', 'v použití').replace('Mirror', 'Zrkadlový').replace('Gloss', 'Lesklá');
}

export const MATERIAL_DESC_SK: Record<string, string> = {
  'cotton-jersey': 'Mäkký bavlnený úplet, klasická tričková látka so zamatovým matným leskom.',
  denim: 'Indigový kepr s viditeľným diagonálnym rebrom.',
  linen: 'Plátnová väzba s nopkovitou priadzou a suchým omakom.',
  'silk-satin': 'Splývavý saten so silnými anizotropnými odleskami.',
  leather: 'Polo-anilínová koža s prirodzeným zrnom.',
  'tech-nylon': 'Ripstop nylon s ľahkým zátermom.',
  fleece: 'Ťažký počesaný fleece pre mikiny.',
  'kraft-corrugated': 'Hnedý kraft na 1,5 mm vlne E — najbežnejšia lepenka pre poštové krabice.',
  'white-corrugated': 'Bielený vrchný papier na 3 mm vlne B, ideálny na potlačené krabice.',
  'sbs-board': 'Bielená celulózová lepenka pre retail — ostré ohyby, jasný povrch pre tlač.',
  'gloss-laminate': 'Skladačka s lesklou OPP lamináciou — hlboká farba, zrkadlové odrazy.',
  'soft-touch': 'Zamatová soft-touch laminácia pre prémiové rozbaľovanie.',
  'metallic-foil': 'Lepenka s metalizovanou PET fóliou pre luxusnú kozmetiku.',
  'ppf-gloss': 'Samohojivá TPU fólia 8 mil, krištáľovo číra lesklá vrchná vrstva.',
  'ppf-matte': 'Saténovo matná TPU, z lesklého laku urobí stealth povrch.',
  'ppf-black-gloss': 'Pigmentovaná lesklá TPU — zmena farby s ochranou laku.',
  'ppf-carbon': 'Potlač karbónu 2x2 kepr pod lesklou TPU vrstvou.',
  'ppf-chrome': 'Zrkadlová chrómová TPU fólia s dúhovým efektom.',
};

export const ACTIVITY_SK: Record<string, string> = {
  created: 'vytvorený', updated: 'upravený', exported: 'exportovaný', duplicated: 'duplikovaný', deleted: 'zmazaný',
};

const nf0 = new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n: number, d = 0) => (d === 0 ? nf0 : d === 1 ? nf1 : nf2).format(n);
export function mm(n: number) {
  if (Math.abs(n) >= 10000) return `${nf2.format(n / 1000)} m`;
  return `${nf0.format(n)} mm`;
}
export function area(mm2: number) {
  return `${nf2.format(mm2 / 1e6)} m²`;
}
export function pct(x: number) {
  return `${nf1.format(x * 100)} %`;
}
export function ago(iso: string) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: sk }); } catch { return ''; }
}
export function dateTime(iso: string) {
  try { return format(new Date(iso), 'd. M. yyyy, HH:mm', { locale: sk }); } catch { return iso; }
}
export function templateName(productType: ProductType, template: string) {
  if (template.startsWith('sample:')) return `Vzorka · ${SAMPLE_SK[template.slice(7)]?.name ?? template.slice(7)}`;
  return TEMPLATE_SK[template]?.name ?? template;
  void productType;
}
export function engineError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  if (/not implemented/i.test(m)) return 'Výpočtové jadro sa práve dokončuje. Táto funkcia bude dostupná o chvíľu.';
  return m;
}
