import { StyleSheet, View } from 'react-native';
import { colors } from '../constants/colors';

const CORNER_LENGTH = 24;
const STROKE_WIDTH = 3;

type Props = {
  width: number;
  height: number;
};

export function CardGuideOverlay({ width, height }: Props) {
  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      <View style={styles.guide}>
        <View style={[styles.h, styles.topLeft, { width: CORNER_LENGTH }]} />
        <View style={[styles.v, styles.topLeft, { height: CORNER_LENGTH }]} />
        <View style={[styles.h, styles.topRight, { width: CORNER_LENGTH }]} />
        <View style={[styles.v, styles.topRight, { height: CORNER_LENGTH }]} />
        <View style={[styles.h, styles.bottomLeft, { width: CORNER_LENGTH }]} />
        <View style={[styles.v, styles.bottomLeft, { height: CORNER_LENGTH }]} />
        <View style={[styles.h, styles.bottomRight, { width: CORNER_LENGTH }]} />
        <View style={[styles.v, styles.bottomRight, { height: CORNER_LENGTH }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  guide: {
    width: '85%',
    aspectRatio: 2.5 / 3.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 8,
  },
  h: {
    position: 'absolute',
    height: STROKE_WIDTH,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  v: {
    position: 'absolute',
    width: STROKE_WIDTH,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  topLeft: {
    top: -STROKE_WIDTH / 2,
    left: -STROKE_WIDTH / 2,
  },
  topRight: {
    top: -STROKE_WIDTH / 2,
    right: -STROKE_WIDTH / 2,
  },
  bottomLeft: {
    bottom: -STROKE_WIDTH / 2,
    left: -STROKE_WIDTH / 2,
  },
  bottomRight: {
    bottom: -STROKE_WIDTH / 2,
    right: -STROKE_WIDTH / 2,
  },
});
