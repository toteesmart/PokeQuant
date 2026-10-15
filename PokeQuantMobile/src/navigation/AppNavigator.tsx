import { Ionicons } from '@expo/vector-icons';
import {
  NavigationContainer,
  DarkTheme,
  useIsFocused,
} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/colors';
import {
  controls,
  radius,
  spacing,
  type_,
  weight,
} from '../constants/theme';
import { DownloadProgressPill } from '../components/ui';
import { InventoryScreen } from '../screens/InventoryScreen';
import { SearchBuyScreen } from '../screens/SearchBuyScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ShowsScreen } from '../screens/ShowsScreen';

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.error,
  },
};

type RootTabParamList = {
  Inventory: undefined;
  Scan: undefined;
  Search: undefined;
  Shows: undefined;
  Settings: undefined;
};

declare global {
   
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- React Navigation typing requires interface augmentation, not a type alias
    interface RootParamList extends RootTabParamList {}
  }
}

const Tab = createBottomTabNavigator<RootTabParamList>();

// Tab screens stay mounted on blur — gate the camera on focus so it actually
// powers down when the user navigates away (otherwise the sensor keeps
// streaming and drains battery).
function ScanTabScreen() {
  const focused = useIsFocused();
  return <ScannerScreen embedded active={focused} />;
}

const TAB_PILL_HEIGHT = 56;

// Floating pill tab bar — content scrolls under it, so every scene gets
// bottom clearance via screenOptions.sceneStyle instead of each screen
// padding itself.
function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Image-pack progress floats top-center over every scene — except Scan,
  // whose camera HUD owns the top band.
  const showProgressPill = state.routes[state.index].name !== 'Scan';
  return (
    <>
      {showProgressPill ? (
        <View
          style={[
            tabStyles.progressWrap,
            { top: insets.top + spacing.lg },
          ]}
          pointerEvents="none">
          <DownloadProgressPill />
        </View>
      ) : null}
      <View
        style={[
          tabStyles.bar,
          { bottom: insets.bottom + spacing.xl },
        ]}
      >
      {/* Frosted pill — grid content scrolls under it. */}
      <BlurView
        intensity={30}
        tint="dark"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {state.routes.map((route) => {
        const { options } = descriptors[route.key];
        const focused = state.routes[state.index].key === route.key;
        const color = focused ? colors.primary : colors.textMuted;
        const label =
          typeof options.tabBarLabel === 'string'
            ? options.tabBarLabel
            : (options.title ?? route.name);
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        const onLongPress = () =>
          navigation.emit({ type: 'tabLongPress', target: route.key });
        const inner = (
          <View
            style={[
              tabStyles.itemPill,
              focused && tabStyles.itemPillActive,
            ]}
          >
            {options.tabBarIcon?.({ focused, color, size: 20 })}
            <Text
              style={[tabStyles.itemLabel, { color }]}
              numberOfLines={1}
            >
              {label}
            </Text>
          </View>
        );
        // A screen's own tabBarButton wins — Settings uses `() => null`
        // to stay hidden (it opens through the header gear).
        if (options.tabBarButton != null) {
          const CustomButton = options.tabBarButton;
          return (
            <CustomButton
              key={route.key}
              onPress={onPress}
              onLongPress={onLongPress}
              testID={options.tabBarButtonTestID}
              accessibilityState={{ selected: focused }}
              accessibilityLabel={
                options.tabBarAccessibilityLabel ?? label
              }
              style={tabStyles.item}
            >
              {inner}
            </CustomButton>
          );
        }
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            testID={options.tabBarButtonTestID}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={
              options.tabBarAccessibilityLabel ?? label
            }
            style={tabStyles.item}
          >
            {inner}
          </Pressable>
        );
      })}
      </View>
    </>
  );
}

export function AppNavigator() {
  const insets = useSafeAreaInsets();
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        initialRouteName="Inventory"
        tabBar={(props) => <FloatingTabBar {...props} />}
        backBehavior="history"
        screenOptions={{
          sceneStyle: {
            paddingBottom:
              insets.bottom + TAB_PILL_HEIGHT + spacing['8xl'],
          },
          // No nav header — screens own their top chrome via the
          // floating TopChrome row (sync / rail / settings pills).
          headerShown: false,
        }}>
        <Tab.Screen
          name="Inventory"
          component={InventoryScreen}
          options={{
            tabBarLabel: 'Inventory',
            tabBarButtonTestID: 'tab-inventory',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="albums-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Scan"
          options={{
            // The camera supplies its own inset-aware chrome and skips
            // the floating TopChrome pills.
            tabBarLabel: 'Scan',
            tabBarButtonTestID: 'tab-scan',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="scan-outline" color={color} size={size} />
            ),
          }}>
          {() => <ScanTabScreen />}
        </Tab.Screen>
        <Tab.Screen
          name="Search"
          component={SearchBuyScreen}
          options={{
            tabBarLabel: 'Search & Buy',
            tabBarButtonTestID: 'tab-search',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="search-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Shows"
          component={ShowsScreen}
          options={{
            tabBarLabel: 'Shows',
            tabBarButtonTestID: 'tab-shows',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar-outline" color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            // Hidden tab — reachable only via the floating gear pill;
            // with backBehavior="history" the back button returns to
            // the tab the user came from.
            tabBarButton: () => null,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const tabStyles = StyleSheet.create({
  progressWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  bar: {
    position: 'absolute',
    left: spacing['4xl'],
    right: spacing['4xl'],
    height: TAB_PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: controls.minTouchTarget,
  },
  itemPill: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  itemPillActive: { backgroundColor: colors.primaryActive },
  itemLabel: { fontSize: type_.caption, fontWeight: weight.semibold },
});


