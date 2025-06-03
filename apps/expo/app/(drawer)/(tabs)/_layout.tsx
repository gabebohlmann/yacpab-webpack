// apps/expo/app/(drawer)/(tabs)/_layout.tsx
import { Tabs, Redirect, Stack, usePathname } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import {
  findNavigatorLayout,
  TabNavigatorLayoutConfig,
  ScreenConfig,
  // PlaceholderIcon, // Assuming you have or will add an icon component
} from '#config/navigation/layout'; // Adjust path if needed

function capitalizeFirstLetter(string: string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const platform = width < 768 ? 'mobile' : 'desktop';
  const pathname = usePathname();

  const tabsConfig = findNavigatorLayout('(tabs)') as TabNavigatorLayoutConfig | undefined;

  if (!tabsConfig || tabsConfig.type !== 'tabs') {
    console.error("TabLayout: Configuration for '(tabs)' not found.");
    return <Stack.Screen options={{ title: 'Error: Tabs Config Missing', headerShown: true }} />;
  }

  if (platform === 'desktop') {
    // On desktop, this Tabs layout should not display its UI.
    // It redirects to the screen that should be displayed in the main content area.
    // The CustomDrawerContent in (drawer)/_layout.tsx will handle displaying the "flattened" items.
    const initialTabScreenNameInConfig = tabsConfig.tabNavigatorOptions?.initialRouteName; // Should be "(home)/index"
    let redirectHref: string | undefined;

    if (initialTabScreenNameInConfig) {
        const initialScreenDetail = tabsConfig.screens.find(s => s.name === initialTabScreenNameInConfig);
        redirectHref = initialScreenDetail?.href || `/(drawer)/(tabs)/${initialTabScreenNameInConfig}`;
    } else if (tabsConfig.screens.length > 0) {
        const firstScreen = tabsConfig.screens[0];
        redirectHref = firstScreen.href || `/(drawer)/(tabs)/${firstScreen.name}`;
    }

    if (redirectHref) {
      if (pathname === `/(drawer)/(tabs)` || pathname === `/(drawer)/(tabs)/`) {
        console.log(`Desktop: Redirecting from (tabs) base to ${redirectHref}`);
        return <Redirect href={redirectHref} />;
      }
      // If already on a child route of (tabs) (e.g., /(drawer)/(tabs)/(home)/index),
      // this layout acts as a group route, allowing the child to render.
      console.log(`Desktop: (tabs)/_layout.tsx acting as group for ${pathname}`);
      return <Stack screenOptions={{ headerShown: false }} />;
    } else {
      console.warn("Desktop: No initial screen found for (tabs) redirect. Fallback.");
      return <Redirect href="/(drawer)/settings/index" />;
    }
  }

  // --- Mobile: Render the Tabs navigator ---
  return (
    <Tabs
      screenOptions={{
        headerShown: false, // The Drawer navigator provides the main header
        ...(tabsConfig.tabNavigatorOptions?.screenOptions || {}),
      }}
      // initialRouteName now directly matches the 'name' from your config
      initialRouteName={tabsConfig.tabNavigatorOptions?.initialRouteName}
    >
      {(tabsConfig.screens || []).map((screen: ScreenConfig) => {
        // screen.name is now like '(home)/index', 'subs/index' from your config
        const cleanBaseName = screen.name
          .replace(/\/index$/, '')
          .replace(/^\(|\)$/g, '');

        const screenOptionsFromConfig = screen.options || {};

        return (
          <Tabs.Screen
            key={screen.name}
            // The 'name' prop uses the name directly from your config
            // This matches how expo-router finds files like app/(drawer)/(tabs)/(home)/index.tsx
            name={screen.name} 
            options={{
              ...screenOptionsFromConfig,
              title: screenOptionsFromConfig.title || capitalizeFirstLetter(cleanBaseName),
              tabBarLabel: screenOptionsFromConfig.tabBarLabel || screenOptionsFromConfig.title || capitalizeFirstLetter(cleanBaseName),
              // Example for tabBarIcon:
              // tabBarIcon: ({ color, focused }) => (
              //   <PlaceholderIcon
              //     name={screenOptionsFromConfig.tabBarIconName || cleanBaseName}
              //     color={color}
              //     size={24}
              //   />
              // ),
            }}
          />
        );
      })}
    </Tabs>
  );
}