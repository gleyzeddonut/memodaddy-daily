// Port of the app's DailyColors.extract (Mumo/Daily/DailyPalette.swift)
// and Theme.daily(from:) (Mumo/Views/Theme.swift). Keep the numbers in
// step with Swift: this is what makes the mock honest.

export function hsv(r, g, b) {
  const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
  const delta = maxC - minC, v = maxC, s = maxC === 0 ? 0 : delta / maxC;
  if (delta <= 0) return { h: 0, s: 0, v };
  let h;
  if (maxC === r) h = (g - b) / delta;
  else if (maxC === g) h = 2 + (b - r) / delta;
  else h = 4 + (r - g) / delta;
  h /= 6;
  if (h < 0) h += 1;
  return { h, s, v };
}

export const linear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const relLum = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
export const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const LEGIBILITY_TARGET = 4.0; // keep in step with Theme.legibilityTarget

/// The tuner link's patch (x 20–140pt, y 380–430pt of 390×844) in sample-grid units.
function linkRegion(sample) {
  const x0 = Math.floor(20 / 390 * sample), x1 = Math.ceil(140 / 390 * sample);
  const y0 = Math.floor(380 / 844 * sample), y1 = Math.ceil(430 / 844 * sample);
  return { x0, x1: Math.max(x1, x0 + 1), y0, y1: Math.max(y1, y0 + 1) };
}

/// `img` is a loaded, same-origin HTMLImageElement.
export function extract(img, sample = 40) {
  const canvas = document.createElement("canvas");
  canvas.width = sample; canvas.height = sample;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(img, 0, 0, sample, sample);
  const { data } = ctx.getImageData(0, 0, sample, sample);
  const count = sample * sample, bins = 24;
  const binWeight = new Float64Array(bins), binSin = new Float64Array(bins), binCos = new Float64Array(bins), binSat = new Float64Array(bins);
  let sumR = 0, sumG = 0, sumB = 0;
  const region = linkRegion(sample);
  let regionLum = 0, regionCount = 0;
  for (let i = 0; i < count; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    sumR += r; sumG += g; sumB += b;
    const x = i % sample, y = Math.floor(i / sample);
    if (x >= region.x0 && x < region.x1 && y >= region.y0 && y < region.y1) { regionLum += relLum(r, g, b); regionCount++; }
    const { h, s, v } = hsv(r, g, b);
    if (!(s > 0.15 && v > 0.15 && v < 0.985)) continue;
    const w = s * s * Math.min(1, (v - 0.15) / 0.35) * (v > 0.96 ? 0.2 : 1);
    const bin = Math.min(bins - 1, Math.floor(h * bins));
    binWeight[bin] += w;
    binSin[bin] += w * Math.sin(h * 2 * Math.PI);
    binCos[bin] += w * Math.cos(h * 2 * Math.PI);
    binSat[bin] += w * s;
  }
  const n = count;
  const avgR = sumR / n, avgG = sumG / n, avgB = sumB / n;
  const luma = 0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB;
  const linkRegionLuminance = regionCount ? regionLum / regionCount : 0.5;
  let best = 0;
  for (let i = 1; i < bins; i++) if (binWeight[i] > binWeight[best]) best = i;
  if (binWeight[best] >= 0.01 * n) {
    let hue = Math.atan2(binSin[best], binCos[best]) / (2 * Math.PI);
    if (hue < 0) hue += 1;
    return { accentHue: hue, accentSaturation: binSat[best] / binWeight[best], averageRed: avgR, averageGreen: avgG, averageBlue: avgB, averageLuma: luma, linkRegionLuminance, vivid: true };
  }
  const { h, s } = hsv(avgR, avgG, avgB);
  return { accentHue: h, accentSaturation: Math.min(s, 0.25), averageRed: avgR, averageGreen: avgG, averageBlue: avgB, averageLuma: luma, linkRegionLuminance, vivid: false };
}

function hsbToRgb(h, s, b) {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = b * (1 - s), q = b * (1 - s * f), t = b * (1 - s * (1 - f));
  const m = [[b, t, p], [q, b, p], [p, b, t], [p, q, b], [t, p, b], [b, p, q]][i];
  return m;
}
const css = ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
const lumOf = ([r, g, b]) => relLum(r, g, b);
const mixLum = (avg, toward, amount) => relLum(...avg.map((c, i) => c + (toward[i] - c) * amount));

/// Port of Theme.legibleAccent: [s, b] clearing 3:1 over `luminance`, or null.
export function legibleAccent(hue, saturation, brightness, luminance) {
  const ok = (s, b) => contrast(lumOf(hsbToRgb(hue, s, b)), luminance) >= LEGIBILITY_TARGET;
  if (ok(saturation, brightness)) return [saturation, brightness];
  const candidates = [];
  if (luminance < 0.18) {
    for (let b = brightness; b <= 1.0 + 1e-9; b += 0.04) candidates.push([saturation, Math.min(b, 1)]);
    for (let s = saturation; s >= 0.1 - 1e-9; s -= 0.05) candidates.push([Math.max(s, 0), 1.0]);
  } else {
    for (let b = brightness; b >= 0.12 - 1e-9; b -= 0.04) candidates.push([saturation, Math.max(b, 0)]);
  }
  return candidates.find(([s, b]) => ok(s, b)) ?? null;
}
const hex = (v) => "#" + (v >>> 0).toString(16).padStart(6, "0");

const classic = { textPrimary: hex(0x000000), textSecondary: hex(0x6D6D72), recordRed: hex(0xFF3B30) };
const sunset = { textPrimary: hex(0xF2F2F5), textSecondary: hex(0x7C7C88), recordRed: hex(0xE0344B) };

export function palette(colors) {
  const dark = colors.averageLuma < 0.45;
  const base = dark ? sunset : classic;
  const avg = [colors.averageRed, colors.averageGreen, colors.averageBlue];
  const toward = dark ? [0.06, 0.06, 0.08] : [1, 1, 1];
  const surface = (amount) => css(avg.map((c, i) => c + (toward[i] - c) * amount));
  const hue = colors.accentHue;
  const sat = Math.min(Math.max(colors.accentSaturation, 0.2), 0.85);
  const accentSat = colors.accentSaturation < 0.3 ? sat : Math.max(sat, 0.55);
  const accentBright = dark ? 0.92 : 0.62;
  const pageLum = mixLum(avg, toward, dark ? 0.82 : 0.9);
  const [aS, aB] = legibleAccent(hue, accentSat, accentBright, pageLum) ?? [0, dark ? 0.95 : 0];
  const accentRgb = hsbToRgb(hue, aS, aB);
  const linkLum = colors.linkRegionLuminance ?? 0.5;
  let linkAccentRgb = null, linkFallback = false;
  if (contrast(lumOf(accentRgb), linkLum) < LEGIBILITY_TARGET) {
    const l = legibleAccent(hue, accentSat, accentBright, linkLum);
    if (l) linkAccentRgb = hsbToRgb(hue, l[0], l[1]);
    else { linkAccentRgb = linkLum > 0.18 ? [0, 0, 0] : [1, 1, 1]; linkFallback = true; }
  }
  const linkRgb = linkAccentRgb ?? accentRgb;
  return {
    dark,
    background: surface(dark ? 0.82 : 0.9),
    card: surface(dark ? 0.72 : 0.8),
    inset: surface(dark ? 0.62 : 0.7),
    recordRing: surface(dark ? 0.42 : 0.45),
    accent: css(accentRgb),
    accentPressed: css(hsbToRgb(hue, aS, Math.max(aB - 0.12, dark ? 0.2 : 0.1))),
    linkAccent: css(linkRgb),
    linkAdjusted: linkAccentRgb !== null,
    linkFallback,
    linkContrast: contrast(lumOf(linkRgb), linkLum),
    accentContrastOnPage: contrast(lumOf(accentRgb), pageLum),
    textPrimary: base.textPrimary,
    textSecondary: base.textSecondary,
    recordRed: base.recordRed,
    onAccent: dark ? surface(0.85) : "#FFFFFF",
  };
}
