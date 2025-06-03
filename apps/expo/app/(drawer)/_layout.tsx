// apps/expo/app/(drawer)/_layout.tsx
import { Drawer } from 'expo-router/drawer';
import { useRouter, Link, usePathname } from 'expo-router';
import { Pressable, Text, View, useWindowDimensions, StyleSheet } from 'react-native';
import { DrawerActions, useNavigationState } from '@react-navigation/native';
import { DrawerContentScrollView, DrawerNavigationOptions  } from '@react-navigation/drawer';
import { useNavigation } from '@react-navigation/native';

import {
  findNavigatorLayout,
  DrawerNavigatorLayoutConfig,
  NavigationSchemaItem,
  ScreenConfig,
  TabNavigatorLayoutConfig,
} from '#config/navigation/layout';

// --- Icons ---
const BackIcon = () => <Text style={styles.iconText}>‹ Back</Text>;
const HamburgerIcon = () => <Text style={styles.iconTextHeader}>☰</Text>;

function capitalizeFirstLetter(string: string) {
  if (!string) return '';
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// --- Updated CustomDrawerHeaderLeft ---
function CustomDrawerHeaderLeft() {
  const { width } = useWindowDimensions();
  const platform: 'mobile' | 'desktop' = width < 768 ? 'mobile' : 'desktop';

  const router = useRouter();
  const drawerNavigation = useNavigation(); // Standard React Navigation hook

  // Get the name of the currently focused screen *within the Drawer navigator*
  // This helps distinguish if we are on the '(tabs)' screen itself or another drawer screen.
  const drawerNavigatorState = useNavigationState(state => state);
  const currentScreenInDrawer = drawerNavigatorState?.routes[drawerNavigatorState.index]?.name;

  // On desktop, always show the hamburger menu
  if (platform === 'desktop') {
    return (
      <Pressable
        onPress={() => drawerNavigation.dispatch(DrawerActions.toggleDrawer())}
        hitSlop={20}
        style={styles.headerButton}
      >
        <HamburgerIcon />
      </Pressable>
    );
  }

  // On mobile:
  // If we are on the main '(tabs)' screen within the drawer, always show hamburger.
  // The specific options for the '(tabs)' Drawer.Screen also ensure this.
  if (currentScreenInDrawer === '(tabs)') {
    return (
      <Pressable
        onPress={() => drawerNavigation.dispatch(DrawerActions.toggleDrawer())}
        hitSlop={20}
        style={styles.headerButton}
      >
        <HamburgerIcon />
      </Pressable>
    );
  }

  // For other screens within the drawer on mobile (e.g., settings, account):
  // Show "Back" if router.canGoBack() is true.
  if (router.canGoBack()) {
    return (
      <Pressable onPress={() => router.back()} hitSlop={20} style={styles.headerButton}>
        <BackIcon />
      </Pressable>
    );
  }

  // Fallback for other mobile screens if they cannot go back (e.g., if settings was initial route)
  return (
    <Pressable
      onPress={() => drawerNavigation.dispatch(DrawerActions.toggleDrawer())}
      hitSlop={20}
      style={styles.headerButton}
    >
      <HamburgerIcon />
    </Pressable>
  );
}

interface CustomDrawerItemLinkProps {
  label: string;
  href: string;
  currentPathname: string;
  onCloseDrawer: () => void;
}

const CustomDrawerLink: React.FC<CustomDrawerItemLinkProps> = ({ label, href, currentPathname, onCloseDrawer }) => {
  const isFocused = currentPathname === href ||
    (href.endsWith('/index') && currentPathname.startsWith(href.slice(0, -6))) ||
    currentPathname.startsWith(href);

  return (
    <Link href={href as any} asChild style={{ marginHorizontal: 0 }}>
      <Pressable onPress={onCloseDrawer}>
        {({ hovered, pressed }) => (
          <View style={[
            styles.drawerItem,
            isFocused && styles.drawerItemFocused,
            hovered && styles.drawerItemHovered,
            pressed && styles.drawerItemPressed
          ]}>
            <Text style={[styles.drawerItemLabel, isFocused && styles.drawerItemLabelFocused]}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </Link>
  );
};

function CustomDrawerContent(props: { navigation: any }) {
  const { width } = useWindowDimensions();
  const platform: 'mobile' | 'desktop' = width < 768 ? 'mobile' : 'desktop';
  const currentPathname = usePathname();

  const drawerConfig = findNavigatorLayout('(drawer)') as DrawerNavigatorLayoutConfig | undefined;
  if (!drawerConfig) return null;

  const renderableLinks: { label: string; href: string }[] = [];

  if (platform === 'desktop') {
    drawerConfig.screens.forEach(item => {
      if (item.name === '(tabs)' && item.type === 'tabs') {
        const tabsNav = item as TabNavigatorLayoutConfig;
        if (tabsNav.showOn && !tabsNav.showOn.includes('desktop')) {
          (tabsNav.screens || []).forEach(tabScreen => {
            if (!tabScreen.showOn || tabScreen.showOn.includes('desktop')) {
              const href = tabScreen.href || `/(drawer)/(tabs)/${tabScreen.name}`; // name is already like (home)/index
              renderableLinks.push({
                label: tabScreen.options?.drawerLabel || tabScreen.options?.title || capitalizeFirstLetter(tabScreen.name.replace(/\/index$/, '').replace(/^\(|\)$/g, '')),
                href: href,
              });
            }
          });
        }
      } else {
        if (!item.showOn || item.showOn.includes('desktop')) {
          // item.name is like "settings/index"
          const href = (item as ScreenConfig).href || `/(drawer)/${item.name}`;
          renderableLinks.push({
            label: item.options?.drawerLabel || item.options?.title || capitalizeFirstLetter(item.name.replace(/\/index$/, '').replace(/^\(|\)$/g, '')),
            href: href,
          });
        }
      }
    });
  } else { // Mobile
    drawerConfig.screens.forEach(item => {
      if (!item.showOn || item.showOn.includes('mobile')) {
        let href = (item as ScreenConfig).href;
        if (!href) {
          // For (tabs) navigator, or screen groups like (home) if they were direct drawer children.
          // name is already like "(tabs)" or "settings/index"
          href = `/(drawer)/${item.name}`;
        }
        renderableLinks.push({
          label: item.options?.drawerLabel || item.options?.title || capitalizeFirstLetter(item.name.replace(/\/index$/, '').replace(/^\(|\)$/g, '')),
          href: href,
        });
      }
    });
  }

  return (
    <DrawerContentScrollView {...props}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerHeaderText}>Menu</Text>
      </View>
      {renderableLinks.map((linkInfo) => (
        <CustomDrawerLink
          key={linkInfo.href}
          label={linkInfo.label}
          href={linkInfo.href}
          currentPathname={currentPathname}
          onCloseDrawer={() => props.navigation.closeDrawer()}
        />
      ))}
    </DrawerContentScrollView>
  );
}

export default function ResponsiveDrawerLayout() {
  const drawerConfig = findNavigatorLayout('(drawer)') as DrawerNavigatorLayoutConfig | undefined;

  if (!drawerConfig) {
    return <Text>Error: Drawer configuration missing.</Text>;
  }

  const globalScreenOptions: DrawerNavigationOptions = {
    ...(drawerConfig.drawerNavigatorOptions?.screenOptions || {}),
    headerShown: true,
    headerLeft: () => <CustomDrawerHeaderLeft />, // Use the updated CustomDrawerHeaderLeft globally
  };

  const finalDrawerNavOptions = {
    ...drawerConfig.drawerNavigatorOptions,
    drawerContent: (props: any) => <CustomDrawerContent {...props} />,
    // initialRouteName is '(tabs)' from your layout.tsx
  };

  return (
    <Drawer {...finalDrawerNavOptions} screenOptions={globalScreenOptions}>
      <Drawer.Screen
        name="(tabs)"
        options={(drawerConfig.screens.find(s => s.name === '(tabs)')?.options || {})}
      // This screen will use the globalScreenOptions.headerLeft, which is CustomDrawerHeaderLeft.
      // CustomDrawerHeaderLeft will correctly show hamburger for (tabs) on mobile.
      />

      {drawerConfig.screens
        .filter(item => item.name !== '(tabs)' && item.type === 'screen')
        .map((screenItem: ScreenConfig) => (
          <Drawer.Screen
            key={`direct-screen-${screenItem.name}`}
            name={screenItem.name} // This is already 'settings/index', 'options/index' etc.
            options={(screenItem.options || {})}
          // These will also use CustomDrawerHeaderLeft.
          />
        ))}
    </Drawer>
  );
}

const styles = StyleSheet.create({
  iconText: { fontSize: 16, marginLeft: 10, color: '#007AFF' },
  iconTextHeader: { fontSize: 24, marginLeft: 15, color: '#007AFF' },
  headerButton: { paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' }, // Added center
  drawerHeader: { paddingHorizontal: 16, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#EFEFEF', marginBottom: 8 },
  drawerHeaderText: { fontSize: 18, fontWeight: 'bold' },
  drawerItem: { paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderRadius: 4, marginHorizontal: 8, marginVertical: 2 },
  drawerItemFocused: { backgroundColor: 'rgba(0, 122, 255, 0.1)' },
  drawerItemHovered: { backgroundColor: 'rgba(0, 0, 0, 0.05)' },
  drawerItemPressed: { backgroundColor: 'rgba(0, 0, 0, 0.08)' },
  drawerItemLabel: { fontSize: 15, fontWeight: '500', color: '#1C1C1E' },
  drawerItemLabelFocused: { color: '#007AFF', fontWeight: '600' },
});