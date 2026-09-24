import { describe, expect, it } from 'vitest';
import { DARK_COLORS, LIGHT_COLORS } from '../tokens';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('small-text palette contrast', () => {
  it.each([
    ['light', LIGHT_COLORS],
    ['dark', DARK_COLORS],
  ] as const)('%s muted labels remain readable on list and card backgrounds', (_name, palette) => {
    expect(contrast(palette.textMuted, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.textMuted, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
