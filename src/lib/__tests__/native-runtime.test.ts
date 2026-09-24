import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../');
const require = createRequire(import.meta.url);

describe('Android OTA compatibility', () => {
  it('keeps the committed native runtime aligned with the version used for updates', () => {
    const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();
    const config = require(resolve(root, 'app.config.js')).expo;
    const strings = readFileSync(resolve(root, 'android/app/src/main/res/values/strings.xml'), 'utf8');
    const nativeRuntime = strings.match(/<string name="expo_runtime_version">([^<]+)<\/string>/)?.[1];

    expect(config.android.runtimeVersion).toBe(version);
    expect(nativeRuntime).toBe(version);
  });
});
