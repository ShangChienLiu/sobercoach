// Drink unit math and beverage normalization. Pure.
// U.S. standard drink = 14 g pure alcohol = 0.6 fl oz of pure alcohol.

export const ML_PER_FL_OZ = 29.5735;
export const STD_DRINK_FL_OZ_ALCOHOL = 0.6;

export type Beverage = "beer" | "wine" | "shot" | "cocktail" | "cider" | "seltzer" | "drink";

export interface SizeChip {
  label: string;
  volume_ml: number;
  abv: number;
}

/** Exact standard drinks for a known pour, or null when either value is missing. */
export function stdDrinksExact(volumeMl: number | null, abv: number | null, count = 1): number | null {
  if (volumeMl == null || abv == null) return null;
  if (volumeMl <= 0 || abv < 0 || abv > 100 || count < 0) return null;
  const perDrink = (volumeMl / ML_PER_FL_OZ) * (abv / 100) / STD_DRINK_FL_OZ_ALCOHOL;
  return round2(perDrink * count);
}

/** Nominal pacing value: 1.0 standard drink per counted drink. */
export function stdDrinksNominal(count: number): number {
  return round2(Math.max(0, count) * 1.0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BEVERAGE_WORDS: ReadonlyArray<readonly [RegExp, Beverage]> = [
  [/\b(beers?|lagers?|ipas?|pints?|stouts?|ales?|brews?)\b/i, "beer"],
  [/\b(wines?|glass(es)? of (red|white|rosé|rose)|reds?|whites?|ros[eé]s?|prosecco|champagne|bubbly)\b/i, "wine"],
  [/\b(shots?|tequila|whisk(e)?y|vodka|rum|gin|bourbon|mezcal)\b/i, "shot"],
  [/\b(cocktails?|margaritas?|martinis?|old fashioneds?|negronis?|mojitos?|mixed drinks?)\b/i, "cocktail"],
  [/\b(ciders?)\b/i, "cider"],
  [/\b(seltzers?|white claws?|hard seltzers?)\b/i, "seltzer"],
];

export function normalizeBeverage(text: string): Beverage {
  for (const [re, bev] of BEVERAGE_WORDS) {
    if (re.test(text)) return bev;
  }
  return "drink";
}

export function beverageLabel(bev: string, count: number): string {
  const plural = count !== 1;
  switch (bev) {
    case "beer": return plural ? "beers" : "beer";
    case "wine": return plural ? "glasses of wine" : "glass of wine";
    case "shot": return plural ? "shots" : "shot";
    case "cocktail": return plural ? "cocktails" : "cocktail";
    case "cider": return plural ? "ciders" : "cider";
    case "seltzer": return plural ? "seltzers" : "seltzer";
    default: return plural ? "drinks" : "drink";
  }
}

/** Size chips offered when a pour's size or strength is unknown. */
export function sizeChipsFor(bev: string): SizeChip[] {
  switch (bev) {
    case "wine":
      return [
        { label: "5 oz · 12%", volume_ml: 148, abv: 12 },
        { label: "8 oz pour · 12%", volume_ml: 237, abv: 12 },
        { label: "5 oz · 14%", volume_ml: 148, abv: 14 },
      ];
    case "beer":
      return [
        { label: "12 oz · 5%", volume_ml: 355, abv: 5 },
        { label: "Pint · 7% IPA", volume_ml: 473, abv: 7 },
        { label: "Tallboy 16 oz · 5%", volume_ml: 473, abv: 5 },
      ];
    case "shot":
      return [
        { label: "1.5 oz · 40%", volume_ml: 44, abv: 40 },
        { label: "Double · 40%", volume_ml: 89, abv: 40 },
      ];
    case "cocktail":
      return [
        { label: "Single pour · ~1.5 oz 40%", volume_ml: 44, abv: 40 },
        { label: "Strong · ~3 oz 40%", volume_ml: 89, abv: 40 },
      ];
    case "cider":
    case "seltzer":
      return [{ label: "12 oz · 5%", volume_ml: 355, abv: 5 }];
    default:
      return [
        { label: "Beer 12 oz · 5%", volume_ml: 355, abv: 5 },
        { label: "Wine 5 oz · 12%", volume_ml: 148, abv: 12 },
        { label: "Shot 1.5 oz · 40%", volume_ml: 44, abv: 40 },
      ];
  }
}

/** Format a standard-drink figure, marking estimates. */
export function formatStd(std: number, isEstimate: boolean): string {
  const s = std.toFixed(1);
  return isEstimate ? `~${s} std drinks (est.)` : `${s} std drinks`;
}

/** Parse a count word or digit string into a number. */
export function parseCount(raw: string): number | null {
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    couple: 2, few: 3, half: 0.5,
  };
  const lower = raw.trim().toLowerCase();
  if (lower in words) return words[lower];
  const n = Number(lower);
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n : null;
}
