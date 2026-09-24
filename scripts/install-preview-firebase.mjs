import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.EAS_BUILD_PLATFORM === 'android') {
  const source = process.env.GOOGLE_SERVICES_JSON;
  if (!source || !fs.existsSync(source)) {
    throw new Error('The preview Android Firebase config is missing from this EAS build.');
  }

  const config = JSON.parse(fs.readFileSync(source, 'utf8'));
  const packages = Array.isArray(config.client) ? config.client.map(
    (client) => client.client_info?.android_client_info?.package_name,
  ) : [];
  if (
    config.project_info?.project_id !== 'zyndmail-native-preview' ||
    packages?.length !== 1 ||
    packages[0] !== 'io.zyndpay.mail.preview'
  ) {
    throw new Error('The Firebase config does not belong to ZyndMail Native Preview.');
  }

  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'google-services.json');
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
  console.log('Installed verified preview Android Firebase config for EAS Build.');
}
