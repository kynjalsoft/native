import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface BuildProfile {
  channel?: string;
  environment?: string;
  env?: Record<string, string>;
}

describe('signed production build configuration', () => {
  it('embeds the reviewed company relay origin in both production profiles', () => {
    const config = JSON.parse(readFileSync(new URL('../../../eas.json', import.meta.url), 'utf8')) as {
      build: Record<string, BuildProfile>;
    };
    for (const profileName of ['production', 'production-apk']) {
      expect(config.build[profileName]).toMatchObject({
        channel: 'production', environment: 'production',
        env: { EXPO_PUBLIC_MAIL_PUSH_RELAY_ORIGIN: 'https://mail.zyndpay.io' },
      });
    }
  });
});
