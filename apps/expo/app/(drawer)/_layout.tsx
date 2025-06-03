// apps/expo/app/(drawer)/_layout.tsx
import { Drawer } from 'expo-router/drawer';
import { useRouter, useNavigation, useSegments } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { DrawerActions } from '@react-navigation/native';

// Import navigation configuration
import {
  findNavigatorLayout,
  DrawerNavigatorLayoutConfig,
  NavigationSchemaItem,
} from '#config/navigation/layout';

// --- Placeholder Icons (can be replaced with a real icon library) ---
const BackIcon = () => (
  <Text style={{ fontSize: 16, marginLeft: 10, color: '#007AFF' }}>‹ Back</Text>
);
const HamburgerIcon = () => (
  <Text style={{ fontSize: 24, marginLeft: 15, color: '#007AFF' }}>☰</Text>
);
// --- End Placeholder Icons ---

/**
 * A custom header component that shows a "Back" button when possible,
 * or a hamburger menu icon to open the drawer.
 */
function CustomDrawerHeaderLeft() {
  const router = useRouter();
  const drawerNavigation = useNavigation();
  const drawerState = drawerNavigation.getState();
  const currentDrawerScreenName = drawerState.routes[drawerState.index]?.name;

  const canGoBack = router.canGoBack();

  // Show the back button if we are on a detail screen within the drawer
  // and the global router has history.
  if (currentDrawerScreenName !== '(tabs)' && canGoBack) {
    return (
      <Pressable onPress={() => router.back()} hitSlop={20} style={{ paddingHorizontal: 10 }}>
        <BackIcon />
      </Pressable>
    );
  } else {
    // Otherwise, show the hamburger menu.
    return (
      <Pressable
        onPress={() => drawerNavigation.dispatch(DrawerActions.toggleDrawer())}
        hitSlop={20}
        style={{ paddingHorizontal: 10 }}
      >
        <HamburgerIcon />
      </Pressable>
    );
  }
}

export default function DrawerLayout() {
  // Find the drawer navigator configuration from the central layout file.
  const drawerConfig = findNavigatorLayout('(drawer)') as DrawerNavigatorLayoutConfig | undefined;

  if (!drawerConfig || drawerConfig.type !== 'drawer') {
    console.error("Drawer configuration '(drawer)' not found or is not a drawer navigator!");
    // Fallback or error display
    return <Text>Error: Drawer configuration missing.</Text>;
  }

  // Combine screenOptions from the config with our required custom header.
  const screenOptions = {
    ...drawerConfig.drawerNavigatorOptions?.screenOptions,
    headerShown: true,
    headerLeft: () => <CustomDrawerHeaderLeft />,
  };

  return (
    <Drawer
      // Spread the navigator-specific options from the config
      {...drawerConfig.drawerNavigatorOptions}
      screenOptions={screenOptions}
    >
      {drawerConfig.screens.map((screenOrNavConfig: NavigationSchemaItem) => {
        // The '(tabs)' screen is a special nested navigator.
        // It does not need the '/index' suffix.
        if (screenOrNavConfig.type === 'tabs') {
          return (
            <Drawer.Screen
              key={screenOrNavConfig.name}
              name={screenOrNavConfig.name} // e.g., "(tabs)"
              options={screenOrNavConfig.options as any}
            />
          );
        }

        // For regular screens, append '/index' to the name to match the
        // file system convention (e.g., 'settings' -> 'settings/index').
        if (screenOrNavConfig.type === 'screen') {
          return (
            <Drawer.Screen
              key={screenOrNavConfig.name}
              name={`${screenOrNavConfig.name}/index` as any}
              options={screenOrNavConfig.options as any}
            />
          );
        }

        // Return null for any other type that shouldn't be rendered here.
        return null;
      })}
    </Drawer>
  );
}
// import { Drawer } from 'expo-router/drawer'
// import { useRouter, useNavigation, useSegments } from 'expo-router' // useSegments can be for logging/debugging now
// import { Pressable, Text } from 'react-native'
// import { DrawerActions } from '@react-navigation/native' // Correct import for DrawerActions

// // --- Placeholder Icons (ensure these are defined or imported) ---
// const BackIcon = () => (
//   <Text style={{ fontSize: 16, marginLeft: 10, color: '#007AFF' }}>‹ Back</Text>
// )
// const HamburgerIcon = () => (
//   <Text style={{ fontSize: 24, marginLeft: 15, color: '#007AFF' }}>☰</Text>
// )
// // --- End Placeholder Icons ---

// function CustomDrawerHeaderLeft() {
//   const router = useRouter()
//   // Get the navigation object for the current navigator (which is the Drawer)
//   const drawerNavigation = useNavigation()
//   const drawerState = drawerNavigation.getState()
//   const currentDrawerScreenName = drawerState.routes[drawerState.index]?.name

//   const canRouterGoBack = router.canGoBack() // Check global router history

//   // For debugging, you can keep this or log these values:
//   // const segments = useSegments();
//   // console.log('CustomDrawerHeaderLeft:', { currentDrawerScreenName, canRouterGoBack, segments });

//   // The logic:
//   // If the Drawer's current active screen is NOT the one hosting the tabs (i.e., "(tabs)"),
//   // AND the global router has a history to go back to, then show the back button.
//   if (currentDrawerScreenName !== '(tabs)' && canRouterGoBack) {
//     return (
//       <Pressable
//         onPress={() => router.back()}
//         hitSlop={20}
//         style={{ paddingLeft: 5, paddingRight: 10, justifyContent: 'center', height: '100%' }}
//       >
//         <BackIcon />
//       </Pressable>
//     )
//   } else {
//     // Otherwise (either on the (tabs) screen or cannot go back), show the hamburger menu.
//     return (
//       <Pressable
//         onPress={() => drawerNavigation.dispatch(DrawerActions.toggleDrawer())}
//         hitSlop={20}
//         style={{ paddingLeft: 5, paddingRight: 10, justifyContent: 'center', height: '100%' }}
//       >
//         <HamburgerIcon />
//       </Pressable>
//     )
//   }
// }

// export default function DrawerLayout() {
//   return (
//     <Drawer
//       screenOptions={{
//         headerShown: true,
//         headerLeft: () => <CustomDrawerHeaderLeft />,
//       }}
//     >
//       <Drawer.Screen
//         name="(tabs)" // This is the screen in the Drawer that renders your Tab navigator
//         options={{
//           // The title displayed in the header when (tabs) is active will
//           // actually come from the active tab screen's options inside app/(app)/(tabs)/_layout.tsx.
//           // This 'title' is more of a fallback or for the drawer item label if it were visible.
//           title: 'Vidream', // General title for the group
//           drawerItemStyle: { display: 'none' },
//           headerShown: true,
//         }}
//       />
//       <Drawer.Screen
//         name="settings/index"
//         options={{
//           drawerLabel: 'Settings',
//           title: 'Settings',
//         }}
//       />
//       <Drawer.Screen
//         name="options/index"
//         options={{
//           drawerLabel: 'Options',
//           title: 'Options',
//         }}
//       />
//       <Drawer.Screen
//         name="account/index"
//         options={{
//           drawerLabel: 'Account',
//           title: 'Account',
//         }}
//       />
//       <Drawer.Screen
//         name="info/index"
//         options={{
//           drawerLabel: 'Info',
//           title: 'Info',
//         }}
//       />
//     </Drawer>
//   )
// }