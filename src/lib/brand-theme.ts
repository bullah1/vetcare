/**
 * Brand theme (Orange / Black) — editable from Settings, applied live via CSS variables.
 * Values are plain hex; they override the defaults declared in src/styles.css.
 */

export type BrandTheme = {
  primary: string;
  dark: string;
  white: string;
  lightOrange: string;
  lightGray: string;
  borderGray: string;
  success: string;
  danger: string;
};

export const DEFAULT_BRAND_THEME: BrandTheme = {
  primary: "#F55504",
  dark: "#000000",
  white: "#FFFFFF",
  lightOrange: "#FFF1E8",
  lightGray: "#F5F5F5",
  borderGray: "#E5E5E5",
  success: "#16A34A",
  danger: "#DC2626",
};

export const BRAND_THEME_FIELDS: { key: keyof BrandTheme; label: string; hint: string }[] = [
  { key: "primary", label: "Primary", hint: "Buttons, active menu, important actions" },
  { key: "dark", label: "Dark", hint: "Sidebar, headings, strong text" },
  { key: "white", label: "White", hint: "Cards, top header" },
  { key: "lightOrange", label: "Light orange", hint: "Selected row, highlight" },
  { key: "lightGray", label: "Light gray", hint: "Main background, inputs, table header" },
  { key: "borderGray", label: "Border gray", hint: "Borders and dividers" },
  { key: "success", label: "Success", hint: "Paid, stock OK" },
  { key: "danger", label: "Danger", hint: "Delete, cancel, out of stock" },
];

const KEY = "brand-theme-v1";
export const BRAND_THEME_EVENT = "brand-theme-change";

const isHex = (v: unknown): v is string => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

export function getBrandTheme(): BrandTheme {
  if (typeof window === "undefined") return DEFAULT_BRAND_THEME;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_BRAND_THEME;
    const parsed = JSON.parse(raw) as Partial<BrandTheme>;
    const out = { ...DEFAULT_BRAND_THEME };
    for (const k of Object.keys(DEFAULT_BRAND_THEME) as (keyof BrandTheme)[]) {
      if (isHex(parsed[k])) out[k] = parsed[k] as string;
    }
    return out;
  } catch {
    return DEFAULT_BRAND_THEME;
  }
}

/** Mix a hex colour toward another hex colour (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const p = (h: string) => {
    let s = h.replace("#", "");
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

function luminance(hex: string): number {
  let s = hex.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const readable = (bg: string) => (luminance(bg) > 0.6 ? "#111111" : "#FFFFFF");

/** Write the theme onto :root as CSS variables — the whole UI re-renders instantly. */
export function applyBrandTheme(theme: BrandTheme = getBrandTheme()) {
  if (typeof document === "undefined") return;
  const t = theme;
  const ink = mix(t.dark, t.white, 0.04);
  const vars: Record<string, string> = {
    "--background": t.lightGray,
    "--foreground": ink,
    "--card": t.white,
    "--card-foreground": ink,
    "--popover": t.white,
    "--popover-foreground": ink,
    "--primary": t.primary,
    "--primary-foreground": readable(t.primary),
    "--secondary": t.lightGray,
    "--secondary-foreground": ink,
    "--muted": t.lightGray,
    "--muted-foreground": mix(ink, t.white, 0.55),
    "--accent": t.lightOrange,
    "--accent-foreground": mix(t.primary, t.dark, 0.3),
    "--success": t.success,
    "--success-foreground": readable(t.success),
    "--destructive": t.danger,
    "--destructive-foreground": readable(t.danger),
    "--border": t.borderGray,
    "--input": t.borderGray,
    "--ring": t.primary,
    "--chart-1": t.primary,
    "--chart-2": t.dark,
    "--chart-3": t.success,
    "--chart-5": t.danger,
    "--sidebar": t.dark,
    "--sidebar-foreground": mix(t.white, t.dark, 0.06),
    "--sidebar-primary": t.primary,
    "--sidebar-primary-foreground": readable(t.primary),
    "--sidebar-accent": mix(t.dark, t.white, 0.1),
    "--sidebar-accent-foreground": t.white,
    "--sidebar-border": mix(t.dark, t.white, 0.15),
    "--sidebar-ring": t.primary,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export function saveBrandTheme(theme: BrandTheme) {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, JSON.stringify(theme));
  applyBrandTheme(theme);
  window.dispatchEvent(new CustomEvent(BRAND_THEME_EVENT, { detail: theme }));
}

export function resetBrandTheme(): BrandTheme {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
  applyBrandTheme(DEFAULT_BRAND_THEME);
  window.dispatchEvent(new CustomEvent(BRAND_THEME_EVENT, { detail: DEFAULT_BRAND_THEME }));
  return DEFAULT_BRAND_THEME;
}
