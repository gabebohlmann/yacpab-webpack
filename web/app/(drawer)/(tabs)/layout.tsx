// web/app/(drawer)/(tabs)/layout.tsx
            // apps/next/app/(drawer)/(tabs)/layout.tsx
            'use client'

            import React from 'react'
            import {
              createBottomTabNavigator,
              BottomTabNavigationOptions,
            } from '@react-navigation/bottom-tabs'
            import { useColorScheme } from 'react-native' // Keep if used for theming

            import {
              findNavigatorLayout,
              TabNavigatorLayoutConfig,
              PlaceholderIcon,
              ScreenConfig,
              // ScreenOptionsConfig, // Not directly needed if using tabNavigatorOptions.screenOptions
            } from '../../../../packages/app/features/navigation/layout'

            const Tab = createBottomTabNavigator()

            const TabBarIcon = (props: {
              name?: string
              focused: boolean
              color: string
              size: number
            }) => {
              if (!props.name) return null // Or return a default icon
              return (
                <PlaceholderIcon
                  name={props.name}
                  color={props.color}
                  size={props.focused ? props.size + 2 : props.size}
                />
              )
            }

            export default function TabsLayout() {
              const colorScheme = useColorScheme()
              const tabsConfig = findNavigatorLayout('(tabs)') as
                | TabNavigatorLayoutConfig
                | undefined

              if (!tabsConfig || tabsConfig.type !== 'tabs') {
                console.error(
                  "Tabs configuration '(tabs)' not found or is not a tab navigator!"
                )
                // Consider a more user-friendly fallback or error boundary
                return <div>Error: Tabs configuration missing.</div>
              }

              // Extract navigator options and screen options from the configuration
              const navigatorOptions = tabsConfig.tabNavigatorOptions || {}
              const defaultScreenOptions = navigatorOptions.screenOptions || {}

              return (
                <Tab.Navigator
                  // Use initialRouteName from tabNavigatorOptions in your config
                  initialRouteName={navigatorOptions.initialRouteName}
                  // Spread other navigator-level options
                  // Cast to BottomTabNavigationOptions; ensure your TabNavigatorPropsForNavigatorItself is compatible
                  {...(navigatorOptions as BottomTabNavigationOptions)}
                  // screenOptions prop of Tab.Navigator takes precedence over individual screen options
                  // It can be an object or a function.
                  screenOptions={({ route }) => {
                    // Start with default screen options from your config
                    const screenSpecificConfig = tabsConfig.screens.find(
                      (s) => s.name === route.name
                    )

                    // Merge default screen options with any screen-specific overrides if necessary
                    // Note: React Navigation typically merges these, but explicit handling can be clearer.
                    // The options prop on Tab.Screen will handle screen-specific items.
                    // Here, primarily for dynamic things like tabBarIcon.
                    const combinedScreenOptions: BottomTabNavigationOptions = {
                      ...(defaultScreenOptions as BottomTabNavigationOptions), // Base defaults for all tab screens
                      // You can override or add specific options based on the route here if needed
                    }

                    return {
                      ...combinedScreenOptions, // Spread the default/global screen options for tabs
                      tabBarIcon: ({ focused, color, size }) => (
                        <TabBarIcon
                          name={screenSpecificConfig?.options?.tabBarIconName}
                          focused={focused}
                          color={color}
                          size={size}
                        />
                      ),
                      // headerShown is now correctly sourced from screenOptions in your config
                      // If you have `headerShown: false` in tabNavigatorOptions.screenOptions, it will apply.
                      // The explicit `headerShown: false` below is redundant if configured in `defaultScreenOptions`.
                      // Keeping it if there's a specific reason you had it hardcoded.
                      headerShown:
                        defaultScreenOptions.headerShown !== undefined
                          ? defaultScreenOptions.headerShown
                          : false,
                    }
                  }}
                >
                  {tabsConfig.screens.map((screenConfig: ScreenConfig) => (
                    <Tab.Screen
                      key={screenConfig.name}
                      name={screenConfig.name}
                      component={screenConfig.component}
                      // Screen-specific options from your layout configuration
                      // These will merge with or override the navigator's screenOptions
                      options={{
                        ...(screenConfig.options as BottomTabNavigationOptions),
                      }}
                      initialParams={screenConfig.initialParams}
                    />
                  ))}
                </Tab.Navigator>
              )
            }
