// apps/expo/app/(drawer)/(tabs)/_layout.tsx
import { Tabs } from 'expo-router'
import { Text, useColorScheme } from 'react-native' // For icon rendering

// Import navigation configuration and icon component
import {
  findNavigatorLayout,
  TabNavigatorLayoutConfig,
  PlaceholderIcon,
} from '#config/navigation/layout'

// This is a simple TabBarIcon component.
const TabBarIcon = (props: { name?: string; focused: boolean; color: string }) => {
  if (!props.name) return null
  return (
    <PlaceholderIcon name={props.name} color={props.color} size={props.focused ? 26 : 24} />
  )
}

export default function TabLayout() {
  const colorScheme = useColorScheme()
  // Find the tab navigator configuration. The name '(tabs)' is by convention.
  const tabsConfig = findNavigatorLayout('(tabs)') as TabNavigatorLayoutConfig | undefined

  if (!tabsConfig || tabsConfig.type !== 'tabs') {
    console.error("Tabs configuration '(tabs)' not found or is not a tab navigator!")
    // Fallback or error display
    return <Text>Error: Tabs configuration missing.</Text>
  }

  // FIX #1: Get the initial route name from the correct place in the config.
  const originalInitialRouteName = tabsConfig.tabNavigatorOptions?.initialRouteName;

  // And modify it to match the file path convention we are using for screens.
  // If the config says 'home', the navigator needs to look for 'home/index'.
  const initialRouteName = originalInitialRouteName
    ? `${originalInitialRouteName}/index`
    : undefined;

  // FIX #2: Use the correct screenOptions for the tabs.
  // `tabsConfig.tabNavigatorOptions.screenOptions` contains defaults for the screens inside the tabs.
  // `tabsConfig.options` (which has 'Vidream Main') is for the tab navigator itself when it's a screen in the drawer.
  const screenOptions = tabsConfig.tabNavigatorOptions?.screenOptions;

  return (
    <Tabs
      initialRouteName={initialRouteName}
      screenOptions={screenOptions as any}
    >
      {tabsConfig.screens.map((screenConfig) => (
        <Tabs.Screen
          key={screenConfig.name}
          // The `name` prop for each screen must match its file path segment.
          name={`${screenConfig.name}/index`}
          options={{
            ...(screenConfig.options as any), // Options specific to this tab screen
            tabBarIcon: ({ focused, color }) => (
              <TabBarIcon
                name={screenConfig.options?.tabBarIconName}
                focused={focused}
                color={color}
              />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}