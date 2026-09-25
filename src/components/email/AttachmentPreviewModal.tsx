import React from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Image, ActivityIndicator, Platform, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { X, ExternalLink, Share2 } from 'lucide-react-native';
import type { Email } from '../../api/types';
import { spacing, radius, typography, componentSizes, type ThemePalette } from '../../theme/tokens';
import { useColors } from '../../theme/colors';
import { useLocaleStore } from '../../stores/locale-store';
import EmailBodyView from '../EmailBodyView';
import { SafeAreaModal } from '../SafeAreaModal';
import { AdaptiveGlassSurface } from '../AdaptiveGlassSurface';
import type { PreviewKind } from '../../lib/attachment-display';

export interface PreviewItem {
  kind: PreviewKind;
  name: string;
  mimeType: string;
  /** Local file:// URI for images and PDFs. */
  fileUri?: string;
  /** Decoded text for text-like parts. */
  text?: string;
  /** Parsed embedded message for .eml previews. */
  eml?: { subject?: string; from?: string; date?: string; html: string | null; text: string | null };
}

interface Props {
  item: PreviewItem | null;
  loading: boolean;
  onClose: () => void;
  /** Hand the file to an external app (PDF on Android, unsupported types). */
  onOpenExternal: () => void;
  onShare: () => void;
}

/**
 * In-app preview for images, PDFs (iOS renders them in the WebView; Android
 * has no built-in PDF renderer, so it offers the external viewer), text and
 * embedded messages. Anything else goes to the external viewer / share sheet.
 */
export function AttachmentPreviewModal({ item, loading, onClose, onOpenExternal, onShare }: Props) {
  const c = useColors();
  const styles = React.useMemo(() => makeStyles(c), [c]);
  const t = useLocaleStore((s) => s.t);
  const { width } = useWindowDimensions();

  const emlEmail = React.useMemo<Email | null>(() => {
    if (!item?.eml) return null;
    return {
      id: `eml-preview-${item.name}`,
      threadId: '',
      mailboxIds: {},
      keywords: {},
      size: 0,
      receivedAt: item.eml.date ?? new Date().toISOString(),
      hasAttachment: false,
      subject: item.eml.subject,
    };
  }, [item]);

  const renderBody = () => {
    if (loading || !item) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={c.primary} />
        </View>
      );
    }
    switch (item.kind) {
      case 'image':
        return (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.imageScroll}
            maximumZoomScale={4}
            minimumZoomScale={1}
            bouncesZoom
          >
            <Image source={{ uri: item.fileUri }} style={{ width: width - spacing.lg * 2, height: width * 1.2 }} resizeMode="contain" />
          </ScrollView>
        );
      case 'pdf':
        if (Platform.OS === 'ios' && item.fileUri) {
          return (
            <WebView
              source={{ uri: item.fileUri }}
              originWhitelist={['file://*']}
              allowFileAccess
              allowingReadAccessToURL={item.fileUri}
              style={styles.flex}
              javaScriptEnabled={false}
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(req) => req.url === item.fileUri}
            />
          );
        }
        return (
          <View style={styles.centered}>
            <Text style={styles.hint}>{t('email_viewer.preview.pdf_external', 'PDFs open in your PDF viewer on this device.')}</Text>
            <Pressable style={styles.button} onPress={onOpenExternal}>
              <ExternalLink size={16} color={c.primaryForeground} />
              <Text style={styles.buttonText}>{t('email_viewer.preview.open_external', 'Open in app')}</Text>
            </Pressable>
          </View>
        );
      case 'text':
        return (
          <ScrollView style={styles.flex} contentContainerStyle={styles.textScroll}>
            <Text selectable style={styles.text}>{item.text ?? ''}</Text>
          </ScrollView>
        );
      case 'eml':
        return (
          <ScrollView style={styles.flex}>
            <View style={styles.emlHeader}>
              <Text style={styles.emlSubject}>{item.eml?.subject || t('email_viewer.no_subject', '(No Subject)')}</Text>
              {item.eml?.from ? <Text style={styles.emlMeta}>{item.eml.from}</Text> : null}
              {item.eml?.date ? <Text style={styles.emlMeta}>{item.eml.date}</Text> : null}
            </View>
            {emlEmail && (
              <EmailBodyView
                email={emlEmail}
                bodyOverride={{ html: item.eml?.html, text: item.eml?.text }}
              />
            )}
          </ScrollView>
        );
      default:
        return (
          <View style={styles.centered}>
            <Text style={styles.hint}>{t('email_viewer.preview.unsupported', 'No preview for this file type.')}</Text>
            <Pressable style={styles.button} onPress={onOpenExternal}>
              <ExternalLink size={16} color={c.primaryForeground} />
              <Text style={styles.buttonText}>{t('email_viewer.preview.open_external', 'Open in app')}</Text>
            </Pressable>
          </View>
        );
    }
  };

  return (
    <SafeAreaModal visible={!!item || loading} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.headerBtn} hitSlop={8}
            accessibilityRole="button" accessibilityLabel={t('common.close', 'Close')}>
            <AdaptiveGlassSurface style={styles.headerBtnSurface} fallbackColor={c.surface} />
            <X size={22} color={c.text} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{item?.name ?? ''}</Text>
          <Pressable onPress={onShare} style={styles.headerBtn} hitSlop={8} disabled={!item}
            accessibilityRole="button" accessibilityLabel={t('files.share', 'Share')}>
            <AdaptiveGlassSurface style={styles.headerBtnSurface} fallbackColor={c.surface} />
            <Share2 size={20} color={item ? c.text : c.textMuted} />
          </Pressable>
        </View>
        {renderBody()}
      </SafeAreaView>
    </SafeAreaModal>
  );
}

function makeStyles(c: ThemePalette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: componentSizes.headerHeight,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      gap: spacing.sm,
    },
    headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
    headerBtnSurface: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.full },
    title: { ...typography.bodySemibold, color: c.text, flex: 1, textAlign: 'center', minWidth: 0 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
    hint: { ...typography.body, color: c.textMuted, textAlign: 'center' },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: c.primary,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
    },
    buttonText: { ...typography.bodySemibold, color: c.primaryForeground },
    imageScroll: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg, flexGrow: 1 },
    textScroll: { padding: spacing.lg },
    text: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: c.text },
    emlHeader: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: c.border, gap: 2 },
    emlSubject: { ...typography.bodySemibold, color: c.text },
    emlMeta: { ...typography.caption, color: c.textSecondary },
  });
}
