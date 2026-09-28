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
  for (let i = 0; i < count; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    sumR += r; sumG += g; sumB += b;
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
  let best = 0;
  for (let i = 1; i < bins; i++) if (binWeight[i] > binWeight[best]) best = i;
  if (binWeight[best] >= 0.01 * n) {
    let hue = Math.atan2(binSin[best], binCos[best]) / (2 * Math.PI);
    if (hue < 0) hue += 1;
    return { accentHue: hue, accentSaturation: binSat[best] / binWeight[best], averageRed: avgR, averageGreen: avgG, averageBlue: avgB, averageLuma: luma, vivid: true };
  }
  const { h, s } = hsv(avgR, avgG, avgB);
  return { accentHue: h, accentSaturation: Math.min(s, 0.25), averageRed: avgR, averageGreen: avgG, averageBlue: avgB, averageLuma: luma, vivid: false };
}

function hsbToRgb(h, s, b) {
  const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6);
  const p = b * (1 - s), q = b * (1 - s * f), t = b * (1 - s * (1 - f));
  const m = [[b, t, p], [q, b, p], [p, b, t], [p, q, b], [t, p, b], [b, p, q]][i];
  return m;
}
const css = ([r, g, b]) => `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
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
  return {
    dark,
    background: surface(dark ? 0.82 : 0.9),
    card: surface(dark ? 0.72 : 0.8),
    inset: surface(dark ? 0.62 : 0.7),
    recordRing: surface(dark ? 0.42 : 0.45),
    accent: css(hsbToRgb(hue, accentSat, accentBright)),
    accentPressed: css(hsbToRgb(hue, accentSat, dark ? 0.8 : 0.5)),
    textPrimary: base.textPrimary,
    textSecondary: base.textSecondary,
    recordRed: base.recordRed,
    onAccent: dark ? surface(0.85) : "#FFFFFF",
  };
}
