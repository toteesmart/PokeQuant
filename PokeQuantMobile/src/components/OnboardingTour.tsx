import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
  Animated,
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
const TYPING_CHAR_MS = 80;
const TYPING_FILTER_DELAY_MS = 120;

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Home Dashboard',
    description: 'Hi! Welcome to PokeQuant. Let me show you around.',
    targetScreen: 'Home',
    pointerPosition: { bottom: 100, left: '10%' },
    pointerAlignment: 'top',
  },
  {
    title: 'Instant Search & Buy Rates',
    description:
      'Look up singles offline from the local catalog, calculate buy offers against market value, and add cards to your buy cart.',
    targetScreen: 'SearchBuy',
    pointerPosition: { bottom: 100, left: '10%' },
    pointerAlignment: 'top',
    mockActionText: 'Lugia V',
  },
  {
    title: 'Inventory & Asset Intake',
    description:
      "Manage your inventory in a responsive 2-column grid. Tap 'Add Asset' or 'Bulk Import' to rapidly ingest raw singles, slabs, or card show lots.",
    targetScreen: 'Inventory',
    pointerPosition: { bottom: 100, left: '10%' },
    pointerAlignment: 'top',
  },
  {
    title: 'Vendor Settings',
    description:
      'Configure your buy percentage tiers and sticker rounding rules here. You are all set to vend!',
    targetScreen: 'Settings',
    pointerPosition: { bottom: 100, left: '10%' },
    pointerAlignment: 'top',
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

export function OnboardingTour() {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();
  const { isTourActive, completeTour } = useVendorSettings();
  const {
    setTourSearchInput,
    setTourSearchFilter,
    setTourSearchTyping,
    setTourAddAssetOpen,
  } = useTour();

  const [stepIndex, setStepIndex] = useState(0);
  const [showCard, setShowCard] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const step = TOUR_STEPS[stepIndex];
  const isLastStep = stepIndex === TOUR_STEPS.length - 1;

  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(16)).current;

  const cleanupSimulation = useCallback(() => {
    setTourSearchInput('');
    setTourSearchFilter('');
    setTourSearchTyping(false);
    setTourAddAssetOpen(false);
  }, [
    setTourSearchInput,
    setTourSearchFilter,
    setTourSearchTyping,
    setTourAddAssetOpen,
  ]);

  const applyStepSimulation = useCallback(
    (tourStep: TourStep) => {
      if (!isTourActive) {
        cleanupSimulation();
        return;
      }

      switch (tourStep.targetScreen) {
        case 'SearchBuy':
          setTourAddAssetOpen(false);
          break;
        case 'Inventory':
          setTourSearchInput('');
          setTourSearchFilter('');
          setTourSearchTyping(false);
          setTourAddAssetOpen(true);
          break;
        case 'Settings':
        default:
          setTourSearchInput('');
          setTourSearchFilter('');
          setTourSearchTyping(false);
          setTourAddAssetOpen(false);
          break;
      }
    },
    [
      isTourActive,
      setTourSearchInput,
      setTourSearchFilter,
      setTourSearchTyping,
      setTourAddAssetOpen,
      cleanupSimulation,
    ]
  );

  const navigateToStep = useCallback(
    (index: number) => {
      if (index < 0 || index >= TOUR_STEPS.length) return;

      setShowCard(false);
      setIsNavigating(true);

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
      cleanupSimulation();
    }
  }, [isTourActive, navigateToStep, cleanupSimulation]);

  useEffect(() => {
    applyStepSimulation(step);
  }, [step, stepIndex, applyStepSimulation]);

  useEffect(() => {
    if (!showCard) {
      cardOpacity.setValue(0);
      cardSlide.setValue(16);
      return;
    }

    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(cardSlide, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [showCard, cardOpacity, cardSlide]);

  useEffect(() => {
    if (!isTourActive || !showCard || step.targetScreen !== 'SearchBuy') {
      return;
    }

    const target = step.mockActionText ?? 'Lugia V';

    setTourSearchInput('');
    setTourSearchFilter('');
    setTourSearchTyping(true);
    setTourAddAssetOpen(false);

    const timeouts: ReturnType<typeof setTimeout>[] = [];

    for (let i = 0; i < target.length; i += 1) {
      timeouts.push(
        setTimeout(() => {
          setTourSearchInput(target.slice(0, i + 1));
        }, i * TYPING_CHAR_MS)
      );
    }

    timeouts.push(
      setTimeout(() => {
        setTourSearchFilter(target);
        setTourSearchTyping(false);
      }, target.length * TYPING_CHAR_MS + TYPING_FILTER_DELAY_MS)
    );

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [
    isTourActive,
    showCard,
    step,
    stepIndex,
    setTourSearchInput,
    setTourSearchFilter,
    setTourSearchTyping,
    setTourAddAssetOpen,
  ]);

  const handleNext = () => {
    if (isNavigating) return;

    cleanupSimulation();

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
    left: (step.pointerPosition.left ?? '10%') as ViewStyle['left'],
    right: step.pointerPosition.right as ViewStyle['right'],
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={isTourActive}
      onRequestClose={finishTour}
      presentationStyle="overFullScreen"
      statusBarTranslucent>
      <View style={styles.overlay} pointerEvents="box-none">
        {showCard && (
          <Animated.View
            style={[
              styles.card,
              cardPositionStyle,
              {
                opacity: cardOpacity,
                transform: [{ translateY: cardSlide }],
              },
            ]}
            pointerEvents="auto">
            <View style={getArrowContainerStyle(step.pointerAlignment)}>
              <Arrow
                direction={step.pointerAlignment}
                color={colors.primary}
              />
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
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    zIndex: 9999,
    elevation: 99,
    backgroundColor: 'rgba(14, 17, 23, 0.5)',
  },
  card: {
    width: '80%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 99,
    zIndex: 9999,
  },
  progress: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 18,
  },
  actions: {
    gap: 8,
  },
  nextButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  nextButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  skipButton: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  skipButtonPressed: {
    opacity: 0.6,
  },
  skipButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
