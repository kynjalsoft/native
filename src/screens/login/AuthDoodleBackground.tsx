import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useColors } from '../../theme/colors';

/** Quiet, decorative line art shared by every step of the sign-in flow. */
export default function AuthDoodleBackground() {
  const { text } = useColors();

  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
    >
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
        <Path
          d="M-80 116C-24 70 31 56 78 79c34 17 32 63 8 82-27 21-58 2-48-25 9-24 42-19 51 5 17 44-17 76-57 65-35-10-54-42-93-33M288-56c-29 46-29 86 4 105 24 14 52 8 62-13 12-24-7-44-28-35-16 7-17 29-1 35 28 10 65-9 81-37"
          fill="none"
          stroke={text}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.075}
        />
        <Path
          d="M337 113c-15-22-26-26-34-14-8 12 1 25 25 37-25 3-35 13-27 27 8 13 23 12 39-4 5 27 16 36 29 26 11-9 9-25-7-42 25-5 33-17 24-29-9-13-23-12-37 4-3-25-10-31-22-24-9 5-9 13 10 19Z"
          fill={text}
          fillOpacity={0.025}
          stroke={text}
          strokeWidth={1.8}
          strokeLinejoin="round"
          opacity={0.09}
        />
        <Path
          d="M417 279c-47-30-94-21-104 11-8 26 10 49 32 47 20-2 30-24 17-37-11-12-27-3-27 9m66 28c-31 12-49 37-44 66 4 22 23 34 42 27M-30 527c49-35 91-35 112-8 22 28 5 57-24 55-22-1-31-23-19-35 11-12 26-3 26 9"
          fill="none"
          stroke={text}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.065}
        />
        <Path
          d="M-50 708c51-19 78-5 90 24 9 24 38 35 60 20 24-17 19-48-6-57-19-7-37 3-38 19m270 72c-27-18-28-40-8-53 16-11 37-4 39 12 2 15-13 23-23 14m42-69c-10-35 2-60 34-71"
          fill="none"
          stroke={text}
          strokeWidth={2.2}
          strokeLinecap="round"
          opacity={0.08}
        />
        <Path
          d="M166 871c-8-26 1-47 28-53 19-5 37 3 38 17 1 14-13 23-25 16-10-6-9-17-3-22m-121-12c11-19 26-23 46-15"
          fill="none"
          stroke={text}
          strokeWidth={2}
          strokeLinecap="round"
          opacity={0.07}
        />
        <Circle cx={267} cy={92} r={3} fill={text} opacity={0.08} />
        <Circle cx={280} cy={104} r={2} fill={text} opacity={0.08} />
        <Circle cx={116} cy={493} r={2.5} fill={text} opacity={0.075} />
        <Circle cx={129} cy={505} r={1.5} fill={text} opacity={0.075} />
        <Circle cx={282} cy={751} r={3} fill={text} opacity={0.075} />
      </Svg>
    </View>
  );
}
