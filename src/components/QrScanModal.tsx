import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Camera, Flashlight, Monitor, X } from 'lucide-react-native';
import { spacing, typography } from '../theme/tokens';
import Button from './Button';
import { SafeAreaModal } from './SafeAreaModal';
import { useLocaleStore } from '../stores/locale-store';

interface QrScanModalProps {
  visible: boolean;
  onClose: () => void;
  // Fires once with the raw decoded QR string. The parent is responsible for
  // closing the modal and interpreting the payload.
  onScanned: (data: string) => void;
}

const SCANNER_BACKGROUND = '#0A1020';
const SCANNER_SURFACE = '#172238';
const SCANNER_ACCENT = '#78ADFF';

export function QrScanModal({ visible, onClose, onScanned }: QrScanModalProps) {
  const t = useLocaleStore((st) => st.t);
  const [permission, requestPermission] = useCameraPermissions();
  const [torchOn, setTorchOn] = React.useState(false);
  const { width, height, fontScale } = useWindowDimensions();
  const compact = height < 650 || fontScale > 1.25;
  const scanSize = Math.max(
    150,
    Math.min(width - 48, 328, height * (compact ? 0.3 : 0.39), 328 / Math.max(1, fontScale)),
  );
  // Guards against the camera firing onBarcodeScanned dozens of times for the
  // same code before the modal tears down.
  const handled = React.useRef(false);
  // Once iOS/Android stops letting us re-prompt, the only path left is Settings.
  const blocked = !!permission && !permission.granted && !permission.canAskAgain;

  React.useEffect(() => {
    if (visible) handled.current = false;
    else setTorchOn(false);
  }, [visible]);

  const handleBarcode = React.useCallback(
    (result: BarcodeScanningResult) => {
      if (handled.current) return;
      handled.current = true;
      onScanned(result.data);
    },
    [onScanned],
  );

  return (
    <SafeAreaModal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={SCANNER_BACKGROUND} />
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('login.mobile.qr_close', 'Close scanner')}
              hitSlop={8}
            >
              <X size={22} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {t('login.mobile.scan_title', 'Scan a sign-in code')}
            </Text>
            <View style={styles.headerSpacer} />
          </View>

          {permission?.granted ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              scrollEnabled={compact}
              showsVerticalScrollIndicator={false}
            >
              <View style={[styles.scanArea, compact && styles.scanAreaCompact]}>
                <View style={[styles.cameraFrame, { width: scanSize, height: scanSize }]}>
                  <CameraView
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    enableTorch={torchOn}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={handleBarcode}
                  />
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                  </View>
                </View>
                <Pressable
                  onPress={() => setTorchOn((current) => !current)}
                  style={({ pressed }) => [
                    styles.torchButton,
                    torchOn && styles.torchButtonActive,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: torchOn }}
                  accessibilityLabel={
                    torchOn
                      ? t('login.mobile.qr_flashlight_off', 'Turn off flashlight')
                      : t('login.mobile.qr_flashlight_on', 'Turn on flashlight')
                  }
                >
                  <Flashlight size={20} color={torchOn ? SCANNER_BACKGROUND : '#E8EDF7'} />
                </Pressable>
              </View>
              <View
                style={[
                  styles.instructionCard,
                  compact && styles.instructionCardCompact,
                  fontScale > 1.5 && styles.instructionCardAccessibility,
                ]}
              >
                <View style={styles.instructionIcon}>
                  <Monitor size={22} color={SCANNER_ACCENT} />
                </View>
                <View style={styles.instructionCopy}>
                  <Text style={styles.instructionTitle}>
                    {t('login.mobile.qr_hint_title', 'Open your webmail on a computer')}
                  </Text>
                  <Text style={styles.instructionBody}>
                    {t('login.mobile.qr_hint', 'Settings → Security → Link device shows a code. Point the camera at it.')}
                  </Text>
                </View>
              </View>
            </ScrollView>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.permissionScroll}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.permissionWrap}>
                <View style={styles.permissionIcon}>
                  <Camera size={30} color={SCANNER_ACCENT} />
                </View>
                <Text style={styles.permissionTitle}>
                  {t('login.mobile.qr_title', 'Sign-in code')}
                </Text>
                <Text style={styles.permissionText}>
                  {blocked
                    ? t('login.mobile.camera_disabled', 'Camera access is turned off. Turn it on in Settings to scan a sign-in QR code.')
                    : t('login.mobile.camera_needed', 'Scanning a sign-in QR code uses the camera. The QR code is read on this device only.')}
                </Text>
                {permission ? (
                  <Button
                    variant="default"
                    size="lg"
                    onPress={() => void (blocked ? Linking.openSettings() : requestPermission())}
                  >
                    {blocked ? t('login.mobile.open_settings', 'Open Settings') : t('login.mobile.continue', 'Continue')}
                  </Button>
                ) : (
                  <ActivityIndicator color={SCANNER_ACCENT} />
                )}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </SafeAreaModal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SCANNER_BACKGROUND },
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  permissionScroll: { flexGrow: 1 },
  header: {
    height: 64,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: SCANNER_SURFACE,
    borderWidth: 1,
    borderColor: '#34405A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  headerTitle: { ...typography.h3, color: '#FFFFFF', textAlign: 'center', flexShrink: 1 },
  headerSpacer: { width: 44 },
  scanArea: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl, paddingVertical: spacing.md },
  scanAreaCompact: { gap: spacing.sm, paddingVertical: spacing.xs },
  cameraFrame: {
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#263144',
    borderWidth: 1,
    borderColor: '#50607B',
  },
  corner: { position: 'absolute', width: 42, height: 42, borderColor: SCANNER_ACCENT, borderWidth: 0 },
  topLeft: { top: 12, left: 12, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 13 },
  topRight: { top: 12, right: 12, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 13 },
  bottomLeft: { bottom: 12, left: 12, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 13 },
  bottomRight: { bottom: 12, right: 12, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 13 },
  torchButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCANNER_SURFACE,
    borderWidth: 1,
    borderColor: '#34405A',
  },
  torchButtonActive: { backgroundColor: SCANNER_ACCENT, borderColor: SCANNER_ACCENT },
  instructionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    padding: spacing.lg,
    borderRadius: 22,
    backgroundColor: SCANNER_SURFACE,
    borderWidth: 1,
    borderColor: '#34405A',
  },
  instructionCardCompact: { marginBottom: spacing.sm, padding: spacing.md },
  instructionCardAccessibility: { flexDirection: 'column' },
  instructionIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#213858',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionCopy: { flex: 1, gap: spacing.xs },
  instructionTitle: { ...typography.bodySemibold, color: '#FFFFFF' },
  instructionBody: { ...typography.body, color: '#B8C7DF' },
  permissionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingBottom: 64,
  },
  permissionIcon: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCANNER_SURFACE,
  },
  permissionTitle: { ...typography.h2, color: '#FFFFFF', textAlign: 'center' },
  permissionText: { ...typography.base, color: '#B8C7DF', textAlign: 'center' },
});
