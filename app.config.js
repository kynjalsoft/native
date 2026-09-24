const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const VERSION = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim();

let COMMIT = process.env.GITHUB_SHA || '';
if (!COMMIT) {
  try {
    COMMIT = execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    COMMIT = 'dev';
  }
}
COMMIT = COMMIT.slice(0, 7);

module.exports = {
  expo: {
    name: 'ZyndMail',
    slug: 'zyndmail',
    owner: 'kynjal-softwares',
    // mailto: lets Android/iOS offer the app for mail links in other apps.
    scheme: ['zyndmail', 'mailto'],
    version: VERSION,
    updates: {
      url: 'https://u.expo.dev/e9054c93-18de-4d6a-bc34-38c020130b82',
      requestHeaders: { 'expo-channel-name': 'production' },
    },
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      runtimeVersion: { policy: 'appVersion' },
      supportsTablet: true,
      bundleIdentifier: 'io.zyndpay.mail',
      config: {
        // The app only speaks HTTPS/TLS and uses platform crypto, which is
        // exempt. Declaring it here skips the manual export-compliance
        // questionnaire that otherwise blocks every TestFlight build.
        usesNonExemptEncryption: false,
      },
    },
    android: {
      runtimeVersion: VERSION,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#FFFFFF',
      },
      predictiveBackGestureEnabled: false,
      package: 'io.zyndpay.mail',
      // The AsyncStorage database holds cached message bodies, the outbox and
      // the account registry; the platform backup would ship all of it to the
      // user's Google account. Credentials live in SecureStore (excluded by
      // its own rules) but the mail cache must not leave the device either.
      allowBackup: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      ['expo-splash-screen', {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        backgroundColor: '#ffffff',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#09090b' },
      }],
      ['expo-build-properties', { ios: { deploymentTarget: '16.4', enableSceneSupport: true } }],
      'expo-secure-store',
      ['expo-local-authentication', { faceIDPermission: 'Use Face ID to unlock ZyndMail.' }],
      '@react-native-community/datetimepicker',
      'expo-localization',
      ['expo-notifications', { defaultChannel: 'mail-activity', color: '#C49A54', enableBackgroundRemoteNotifications: true }],
      [
        'expo-camera',
        {
          cameraPermission:
            'ZyndMail uses the camera to scan sign-in QR codes shown in webmail.',
          // QR scanning never records audio; leaving the mic entry in would be
          // an unexplained permission in App Review.
          microphonePermission: false,
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'ZyndMail needs access to your photos so you can attach them to emails and set contact photos.',
          // Only launchImageLibraryAsync is used - no in-app capture.
          cameraPermission: false,
          microphonePermission: false,
        },
      ],
    ],
    extra: {
      commit: COMMIT,
      eas: { projectId: 'e9054c93-18de-4d6a-bc34-38c020130b82' },
    },
  },
};
