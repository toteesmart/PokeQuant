import { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { useTour } from '../context/TourContext';
import { useVendorSettings } from '../context/VendorSettingsContext';

export type PointerAlignment = 'top' | 'bottom' | 'left' | 'right';

export type PointerPosition = {
  top?: number;
  bottom?: number;
  left?: number | string;
  right?: number | string;
};

export type TourStep = {
  title: string;
  description: string;
  targetScreen: string;
  pointerPosition: PointerPosition;
  pointerAlignment: PointerAlignment;
  mockActionText?: string;
};

const ARROW_SIZE = 12;
const BUBBLE_HEIGHT = 34;
const GAP = 6;

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Home Dashboard',
    description: 'Hi! Welcome to PokeQuant. Let me show you around.',
    targetScreen: 'Home',
    pointerPosition: { top: 100, left: '7.5%' },
    pointerAlignment: 'bottom',
  },
  {
    title: 'Instant Search & Buy Rates',
    description:
      'Look up singles offline from the local catalog, calculate buy offers against market value, and add cards to your buy cart.',
    targetScreen: 'SearchBuy',
    pointerPosition: { top: 220, left: '7.5%' },
    pointerAlignment: 'top',
    mockActionText: 'Lugia V',
  },
  {
    title: 'Inventory & Asset Intake',
    description:
      "Manage your inventory in a responsive 2-column grid. Tap 'Add Asset' or 'Bulk Import' to rapidly ingest raw singles, slabs, or card show lots.",
    targetScreen: 'Inventory',
    pointerPosition: { top: 220, left: '7.5%' },
    pointerAlignment: 'top',
    mockActionText: 'Opening Add Asset tray...',
  },
  {
    title: 'Vendor Settings',
    description:
      'Configure your buy percentage tiers and sticker rounding rules here. You are all set to vend!',
    targetScreen: 'Settings',
    pointerPosition: { top: 100, left: '7.5%' },
    pointerAlignment: 'bottom',
    mockActionText: 'Adjusting tier margins...',
  },
];

type RootTabParamList = {
  Home: undefined;
  SearchBuy: undefined;
  Inventory: undefined;
  Settings: undefined;
};

function Arrow({
  direction,
  color,
}: {
  direction: PointerAlignment;
  color: string;
}) {
  const size = ARROW_SIZE;
  const half = size / 2;

  const base = { width: 0, height: 0 } as ViewStyle;

  let arrowStyle: ViewStyle;

  switch (direction) {
    case 'bottom':
      arrowStyle = {
        ...base,
        borderTopWidth: size,
        borderLeftWidth: half,
        borderRightWidth: half,
        borderBottomWidth: 0,
        borderTopColor: color,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
      };
      break;
    case 'top':
      arrowStyle = {
        ...base,
        borderBottomWidth: size,
        borderLeftWidth: half,
        borderRightWidth: half,
        borderTopWidth: 0,
        borderBottomColor: color,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
      };
      break;
    case 'right':
      arrowStyle = {
        ...base,
        borderLeftWidth: size,
        borderTopWidth: half,
        borderBottomWidth: half,
        borderRightWidth: 0,
        borderLeftColor: color,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
      };
      break;
    case 'left':
      arrowStyle = {
        ...base,
        borderRightWidth: size,
        borderTopWidth: half,
        borderBottomWidth: half,
        borderLeftWidth: 0,
        borderRightColor: color,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
      };
      break;
  }

  return <View style={arrowStyle} />;
}

function getArrowContainerStyle(alignment: PointerAlignment): ViewStyle {
  const size = ARROW_SIZE;
  const base: ViewStyle = { position: 'absolute' };

  switch (alignment) {
    case 'bottom':
      return { ...base, bottom: -size, left: '50%' };
    case 'top':
      return { ...base, top: -size, left: '50%' };
    case 'right':
      return { ...base, right: -size, top: '50%' };
    case 'left':
      return { ...base, left: -size, top: '50%' };
  }
}

function getMockBubbleWrapperStyle(
  alignment: PointerAlignment
): ViewStyle {
  const offset = BUBBLE_HEIGHT + ARROW_SIZE + GAP;
  const base: ViewStyle = { position: 'absolute' };

  switch (alignment) {
    case 'bottom':
      return {
        ...base,
        bottom: -offset,
        left: 0,
        right: 0,
        alignItems: 'center',
      };
    case 'top':
      return {
        ...base,
        top: -offset,
        left: 0,
        right: 0,
        alignItems: 'center',
      };
    case 'right':
      return {
        ...base,
        right: -offset,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
      };
    case 'left':
      return {
        ...base,
        left: -offset,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
      };
  }
}

export function OnboardingTour() {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { isTourActive, completeTour } = useVendorSettings();
  const { setTourSearchQuery, setTourAddAssetOpen } = useTour();

  const [stepIndex, setStepIndex] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [mockVisible, setMockVisible] = useState(false);

  const step = TOUR_STEPS[stepIndex];
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  const cleanupSimulation = useCallback(() => {
    setTourSearchQuery('');
    setTourAddAssetOpen(false);
  }, [setTourAddAssetOpen, setTourSearchQuery]);

  const applyStepSimulation = useCallback(
    (tourStep: TourStep) => {
      if (!isTourActive) {
        cleanupSimulation();
        return;
      }

      switch (tourStep.targetScreen) {
        case 'SearchBuy':
          setTourSearchQuery(tourStep.mockActionText ?? 'Lugia V');
          setTourAddAssetOpen(false);
          break;
        case 'Inventory':
          setTourSearchQuery('');
          setTourAddAssetOpen(true);
          break;
        default:
          setTourSearchQuery('');
          setTourAddAssetOpen(false);
          break;
      }
    },
    [cleanupSimulation, isTourActive, setTourSearchQuery, setTourAddAssetOpen]
  );

  const navigateToStep = useCallback(
    (index: number) => {
      if (index < 0 || index >= TOUR_STEPS.length) return;

      setShowCard(false);
      setIsNavigating(true);
      setMockVisible(false);

      navigation.navigate(
        TOUR_STEPS[index].targetScreen as keyof RootTabParamList
      );

      setTimeout(() => {
        setStepIndex(index);
        setShowCard(true);
        setIsNavigating(false);
      }, 300);
    },
    [navigation]
  );

  const finishTour = useCallback(() => {
    cleanupSimulation();
    completeTour();
    navigation.navigate('Home');
  }, [cleanupSimulation, completeTour, navigation]);

  useEffect(() => {
    if (isTourActive) {
      navigateToStep(0);
    } else {
      setShowCard(false);
      setIsNavigating(false);
      setMockVisible(false);
      cleanupSimulation();
    }
  }, [isTourActive, navigateToStep, cleanupSimulation]);

  useEffect(() => {
    applyStepSimulation(step);
  }, [step, stepIndex, applyStepSimulation]);

  useEffect(() => {
    if (!isTourActive || !showCard || !step?.mockActionText) {
      setMockVisible(false);
      return;
    }

    setMockVisible(true);
    const timer = setTimeout(() => setMockVisible(false), 1800);
    return () => clearTimeout(timer);
  }, [isTourActive, showCard, step, stepIndex]);

  const handleNext = () => {
    if (isNavigating) return;

    if (step.targetScreen === 'SearchBuy') {
      setTourSearchQuery('');
    }
    if (step.targetScreen === 'Inventory') {
      setTourAddAssetOpen(false);
    }

    if (isLastStep) {
      finishTour();
    } else {
      navigateToStep(stepIndex + 1);
    }
  };

  const cardPositionStyle: ViewStyle = {
    position: 'absolute',
    top: step.pointerPosition.top,
    bottom: step.pointerPosition.bottom,
    left: (step.pointerPosition.left ?? '7.5%') as ViewStyle['left'],
    right: step.pointerPosition.right as ViewStyle['left'],
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={isTourActive}
      onRequestClose={finishTour}>
      <View style={styles.overlay} pointerEvents="box-none">
        {showCard && (
          <View style={[styles.card, cardPositionStyle]} pointerEvents="auto">
            <View style={getMockBubbleWrapperStyle(step.pointerAlignment)}>
              {mockVisible && (
                <View style={styles.bubble}>
                  <Text style={styles.bubbleText} numberOfLines={1}>
                    {step.mockActionText}
                  </Text>
                </View>
              )}
            </View>

            <View style={getArrowContainerStyle(step.pointerAlignment)}>
              <Arrow direction={step.pointerAlignment} color={colors.primary} />
            </View>

            <Text style={styles.progress}>
              Step {stepIndex + 1} of {TOUR_STEPS.length}
            </Text>
            <Text style={styles.title}>{step.title}</Text>
            <Text style={styles.description}>{step.description}</Text>

            <View style={styles.actions}>
              <Pressable
                onPress={handleNext}
                disabled={isNavigating}
                style={({ pressed }) => [
                  styles.nextButton,
                  (pressed || isNavigating) && styles.buttonPressed,
                ]}>
                <Text style={styles.nextButtonText}>
                  {isLastStep ? 'Done' : 'Next'}
                </Text>
              </Pressable>

              <Pressable
                onPress={finishTour}
                style={({ pressed }) => [
                  styles.skipButton,
                  pressed && styles.skipButtonPressed,
                ]}>
                <Text style={styles.skipButtonText}>Skip Tour</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(14, 17, 23, 0.5)',
  },
  card: {
    width: '85%',
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  bubble: {
    minHeight: BUBBLE_HEIGHT,
    backgroundColor: colors.surfaceLight,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  progress: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  description: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  actions: {
    gap: 10,
  },
  nextButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  nextButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  skipButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  skipButtonPressed: {
    opacity: 0.6,
  },
  skipButtonText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
});
