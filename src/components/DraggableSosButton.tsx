import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText } from './ui';
import { colors } from '../theme';

const BUTTON_SIZE = 74;
const EDGE_MARGIN = 16;
const DRAG_THRESHOLD_PX = 8;

interface DraggableSosButtonProps {
  onPress: () => void;
  boundsWidth: number;
  boundsHeight: number;
  insetTop?: number;
  insetBottom?: number;
  insetLeft?: number;
  insetRight?: number;
}

export function DraggableSosButton({
  onPress,
  boundsWidth,
  boundsHeight,
  insetTop = 8,
  insetBottom = 8,
  insetLeft = 12,
  insetRight = 12,
}: DraggableSosButtonProps) {
  const [isDragging, setIsDragging] = useState(false);

  const minX = insetLeft + EDGE_MARGIN;
  const minY = insetTop + EDGE_MARGIN;
  const maxX = Math.max(minX, boundsWidth - insetRight - EDGE_MARGIN - BUTTON_SIZE);
  const maxY = Math.max(minY, boundsHeight - insetBottom - EDGE_MARGIN - BUTTON_SIZE);

  const clampPos = (x: number, y: number) => ({
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  });

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const currentPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasInitializedRef = useRef(false);
  const boundsRef = useRef({ minX, minY, maxX, maxY });
  boundsRef.current = { minX, minY, maxX, maxY };

  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    if (boundsWidth <= 0 || boundsHeight <= 0) return;

    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const start = clampPos(maxX, maxY);
      currentPosRef.current = start;
      pan.setValue(start);
      return;
    }

    const clamped = clampPos(currentPosRef.current.x, currentPosRef.current.y);
    currentPosRef.current = clamped;
    pan.setValue(clamped);
  }, [boundsWidth, boundsHeight, minX, minY, maxX, maxY, pan]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragOriginRef.current = { ...currentPosRef.current };
        setIsDragging(true);
      },
      onPanResponderMove: (_evt, gestureState) => {
        const b = boundsRef.current;
        const nextX = Math.min(b.maxX, Math.max(b.minX, dragOriginRef.current.x + gestureState.dx));
        const nextY = Math.min(b.maxY, Math.max(b.minY, dragOriginRef.current.y + gestureState.dy));
        currentPosRef.current = { x: nextX, y: nextY };
        pan.setValue({ x: nextX, y: nextY });
      },
      onPanResponderRelease: (_evt, gestureState) => {
        setIsDragging(false);
        const movedDist = Math.hypot(gestureState.dx, gestureState.dy);
        if (movedDist < DRAG_THRESHOLD_PX) {
          onPressRef.current();
        }
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
      },
    })
  ).current;

  if (boundsWidth <= 0 || boundsHeight <= 0) {
    return null;
  }

  return (
    <Animated.View
      testID="floating-sos-button"
      accessible
      accessibilityRole="button"
      accessibilityLabel="Cấp cứu SOS gọi điều dưỡng khẩn cấp"
      accessibilityHint="Chạm để gửi SOS hoặc kéo để di chuyển nút trên màn hình"
      {...panResponder.panHandlers}
      style={[
        styles.wrapper,
        {
          transform: [
            { translateX: pan.x },
            { translateY: pan.y },
            { scale: isDragging ? 0.94 : 1 },
          ],
        },
      ]}
    >
      <View style={styles.circle}>
        <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
        <AppText style={styles.label}>SOS</AppText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    zIndex: 1200,
    elevation: 12,
  },
  circle: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: colors.danger,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7F1D1D',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.38,
    shadowRadius: 10,
    elevation: 10,
  },
  label: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 1,
  },
});
