import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  View,
} from 'react-native';
import { colors } from '../constants/colors';

type SliderProps = {
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onValueChange?: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
};

const THUMB_WIDTH = 20;

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onValueChange,
  onSlidingComplete,
}: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const panX = useRef(new Animated.Value(0)).current;
  const startPageXRef = useRef(0);
  const startXRef = useRef(0);
  const currentValueRef = useRef(value);

  useEffect(() => {
    currentValueRef.current = value;
  }, [value]);

  const valueToX = useCallback(
    (v: number) => {
      if (trackWidth <= 0) return 0;
      const ratio = (v - min) / (max - min);
      return Math.max(0, Math.min(trackWidth, ratio * trackWidth));
    },
    [trackWidth, min, max]
  );

  const xToValue = useCallback(
    (x: number) => {
      if (trackWidth <= 0) return min;
      const ratio = Math.max(0, Math.min(1, x / trackWidth));
      const raw = min + ratio * (max - min);
      return Math.round(raw / step) * step;
    },
    [trackWidth, min, max, step]
  );

  useEffect(() => {
    panX.setValue(valueToX(value));
  }, [value, valueToX, panX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (
          e: GestureResponderEvent,
          _gestureState: PanResponderGestureState
        ) => {
          const x = e.nativeEvent.locationX ?? 0;
          const newValue = xToValue(x);
          panX.setValue(valueToX(newValue));
          currentValueRef.current = newValue;
          onValueChange?.(newValue);
          startPageXRef.current = e.nativeEvent.pageX;
          startXRef.current = valueToX(newValue);
        },
        onPanResponderMove: (
          e: GestureResponderEvent,
          _gestureState: PanResponderGestureState
        ) => {
          const newX = startXRef.current + (e.nativeEvent.pageX - startPageXRef.current);
          const newValue = xToValue(newX);
          panX.setValue(valueToX(newValue));
          currentValueRef.current = newValue;
          onValueChange?.(newValue);
        },
        onPanResponderRelease: () => {
          onSlidingComplete?.(currentValueRef.current);
        },
      }),
    [xToValue, valueToX, onValueChange, onSlidingComplete, panX]
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.track}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}>
        <Animated.View
          style={[styles.thumb, { transform: [{ translateX: panX }] }]}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceLight,
    marginHorizontal: 10,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_WIDTH,
    borderRadius: THUMB_WIDTH / 2,
    backgroundColor: colors.primary,
    position: 'absolute',
    left: -THUMB_WIDTH / 2,
  },
});
