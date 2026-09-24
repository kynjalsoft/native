import type { ThemePalette } from './tokens';

function rgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [number, number, number];
}

function luminance(color: [number, number, number]): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function readableColor(foreground: string, backgrounds: string[]): string {
  const source = rgb(foreground);
  const surfaces = backgrounds.map(rgb);
  if (!source || surfaces.some((surface) => !surface)) return foreground;
  const readable = (color: [number, number, number]) =>
    surfaces.every((surface) => contrast(color, surface!) >= 4.5);
  if (readable(source)) return foreground;

  let best: [number, number, number] | null = null;
  let bestDistance = Infinity;
  for (const target of [0, 255]) {
    let low = 0;
    let high = 1;
    const blend = (amount: number): [number, number, number] =>
      source.map((channel) => Math.round(channel + (target - channel) * amount)) as [number, number, number];
    if (!readable(blend(1))) continue;
    for (let i = 0; i < 16; i++) {
      const midpoint = (low + high) / 2;
      if (readable(blend(midpoint))) high = midpoint;
      else low = midpoint;
    }
    const candidate = blend(high);
    const distance = source.reduce((sum, channel, index) => sum + (channel - candidate[index]) ** 2, 0);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best ? `#${best.map((channel) => channel.toString(16).padStart(2, '0')).join('')}` : foreground;
}

/** Keep generated theme colors intact while making small secondary labels legible. */
export function withReadableBodyText(palette: ThemePalette): ThemePalette {
  const backgrounds = [palette.background, palette.surface];
  const textSecondary = readableColor(palette.textSecondary, backgrounds);
  const textMuted = readableColor(palette.textMuted, backgrounds);
  if (textSecondary === palette.textSecondary && textMuted === palette.textMuted) return palette;
  return { ...palette, textSecondary, textMuted };
}
