import React from 'react';
import { AccessibilityInfo, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useResolvedTheme } from '../theme/colors';

interface Props {
  style: StyleProp<ViewStyle>;
  fallbackColor: string;
}

/** Native iOS material for chrome only; solid surface on older devices or accessibility fallback. */
export function AdaptiveGlassSurface({ style, fallbackColor }: Props) {
  const colorScheme = useResolvedTheme();
  const [reduceTransparency, setReduceTransparency] = React.useState(true);

  React.useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((enabled) => {
      if (mounted) setReduceTransparency(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const canUseGlass = Platform.OS === 'ios' && !reduceTransparency &&
    isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  if (canUseGlass) {
    return <GlassView pointerEvents="none" style={style} glassEffectStyle="regular" colorScheme={colorScheme} />;
  }
  return <View pointerEvents="none" style={[style, { backgroundColor: fallbackColor }]} />;
}
