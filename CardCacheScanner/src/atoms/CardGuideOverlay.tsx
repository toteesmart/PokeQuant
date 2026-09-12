import { StyleSheet, View } from 'react-native';
import { colors } from '../constants/colors';
import { GUIDE_ASPECT, GUIDE_CENTER_Y, GUIDE_WIDTH_FRACTION } from '../constants/guide';

const CORNER_LENGTH = 24;
const STROKE_WIDTH = 3;

type Props = {
  width: number;
  height: number;
};

export function CardGuideOverlay({ width, height }: Props) {
  const frameWidth = width * GUIDE_WIDTH_FRACTION;
  const frameHeight = frameWidth / GUIDE_ASPECT;
  const top = Math.max(0, height * GUIDE_CENTER_Y - frameHeight / 2);
  const left = (width - frameWidth) / 2;

  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      <View style={[styles.guide, { width: frameWidth, height: frameHeight, top, left }]}>
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
  },
  guide: {
    position: 'absolute',
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
