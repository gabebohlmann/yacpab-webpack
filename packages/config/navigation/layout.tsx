// packages/config/navigation/layout.tsx
import { ComponentType } from 'react';
import { Text, ViewStyle } from 'react-native';
import { BottomTabNavigationOptions,
// BottomTabScreenProps, // Keep if used directly
 } from '@react-navigation/bottom-tabs';
import { DrawerNavigationOptions, // Base for screen options within drawer
DrawerScreenProps as RNDrawerScreenProps, } from '@react-navigation/drawer';
import { NativeStackNavigationOptions,
// NativeStackScreenProps, // Keep if used directly
 } from '@react-navigation/native-stack';
import { 
// NavigatorScreenParams, // Keep if you use it for nested navigator params
ParamListBase, // Useful for generic navigator/screen prop types
// RouteProp, // Keep if used directly
 } from '@react-navigation/native';
export const isAutoSaveEnabled = true;
export const isEditing = false;
// --- Generic Configuration Types ---
/**
 * ScreenOptionsConfig: Options that can apply to any screen or to a navigator *when it acts as a screen*.
 * This includes titles, header visibility, and specific UI elements for drawers or tabs.
 * Also used for the 'screenOptions' prop of navigators to define defaults for their child screens.
 */
export interface ScreenOptionsConfig {
    title?: string;
    headerShown?: boolean;
    // For Tab Screens/Items
    tabBarIconName?: string; // Custom prop for your icon component
    tabBarLabel?: string | ((props: {
        focused: boolean;
        color: string;
    }) => React.ReactNode);
    // For Drawer Screens/Items
    drawerLabel?: string | ((props: {
        focused: boolean;
        color: string;
    }) => React.ReactNode);
    drawerIcon?: (props: {
        focused: boolean;
        color: string;
        size: number;
    }) => React.ReactNode;
    drawerItemStyle?: ViewStyle;
    // Allow other React Navigation options
    [key: string]: any;
}
// --- Screen Configuration ---
export interface ScreenConfig {
    type: 'screen';
    name: string;
    component: ComponentType<any>;
    options?: ScreenOptionsConfig;
    href?: string;
    initialParams?: object;
    showOn?: ('mobile' | 'desktop')[];
}
// --- Tab Navigator Specific Types ---
/**
 * TabNavigatorPropsForNavigatorItself: Props that apply directly to the <Tab.Navigator> component.
 */
export interface TabNavigatorPropsForNavigatorItself extends Omit<BottomTabNavigationOptions, 'children' | 'navigationKey' | 'component' | 'name' | 'initialParams'> {
    // Omit screen-specific props
    id?: string;
    initialRouteName?: string;
    screenOptions?: ScreenOptionsConfig; // <<<< CORRECTED: Added screenOptions here
}
export interface TabNavigatorLayoutConfig {
    type: 'tabs';
    name: string;
    screens: ScreenConfig[];
    options?: ScreenOptionsConfig; // Options for this Tab Navigator when it acts as a screen in a parent
    tabNavigatorOptions?: TabNavigatorPropsForNavigatorItself; // Props for the <Tab.Navigator> itself
    initialParams?: object;
    showOn?: ('mobile' | 'desktop')[];
}
// --- Drawer Navigator Specific Types ---
/**
 * DrawerNavigatorPropsForNavigatorItself: Props that apply directly to the <Drawer.Navigator> component.
 */
export interface DrawerNavigatorPropsForNavigatorItself extends Omit<DrawerNavigationOptions, 'children' | 'navigationKey' | 'component' | 'name' | 'initialParams' | 'options'> {
    // Omit screen-specific props
    id?: string;
    initialRouteName?: string;
    defaultStatus?: 'open' | 'closed';
    screenOptions?: ScreenOptionsConfig; // Default for screens inside
    drawerContent?: (props: RNDrawerScreenProps<ParamListBase, string>) => React.ReactNode;
    useLegacyImplementation?: boolean;
    drawerStyle?: ViewStyle;
    overlayColor?: string;
    drawerType?: 'front' | 'back' | 'slide' | 'permanent';
    edgeWidth?: number;
    hideStatusBar?: boolean;
    statusBarAnimation?: 'slide' | 'none' | 'fade';
    keyboardDismissMode?: 'on-drag' | 'none';
    swipeEnabled?: boolean;
    gestureEnabled?: boolean;
}
export interface DrawerNavigatorLayoutConfig {
    type: 'drawer';
    name: string;
    screens: NavigationSchemaItem[];
    options?: ScreenOptionsConfig; // Options for this Drawer Navigator when it acts as a screen
    drawerNavigatorOptions?: DrawerNavigatorPropsForNavigatorItself; // Props for the <Drawer.Navigator>
    initialParams?: object;
    showOn?: ('mobile' | 'desktop')[];
}
// --- Stack Navigator Specific Types ---
/**
 * StackNavigatorPropsForNavigatorItself: Props that apply directly to the <Stack.Navigator> component.
 */
export interface StackNavigatorPropsForNavigatorItself extends Omit<NativeStackNavigationOptions, 'children' | 'navigationKey' | 'component' | 'name' | 'initialParams' | 'options'> {
    // Omit screen-specific props
    id?: string;
    initialRouteName?: string;
    screenOptions?: ScreenOptionsConfig; // <<<< CORRECTED: Added screenOptions here
}
export interface StackNavigatorLayoutConfig {
    type: 'stack';
    name: string;
    screens: NavigationSchemaItem[];
    options?: ScreenOptionsConfig; // Options for this Stack Navigator if it acts as a screen
    stackNavigatorOptions?: StackNavigatorPropsForNavigatorItself; // Props for the <Stack.Navigator>
    initialParams?: object;
}
// --- Union Types for Navigation Structure ---
export type NavigationSchemaItem = ScreenConfig | TabNavigatorLayoutConfig | DrawerNavigatorLayoutConfig | StackNavigatorLayoutConfig;
export type NavigatorLayout = StackNavigatorLayoutConfig | TabNavigatorLayoutConfig | DrawerNavigatorLayoutConfig;
// --- Placeholder Icon (Example) ---
export const PlaceholderIcon = ({ name, color, size, }: {
    name?: string;
    color: string;
    size: number;
}) => (<Text style={{ color: color, fontSize: size, fontWeight: 'bold' }}>
  {name ? name.charAt(0).toUpperCase() : '?'}
</Text>);
// --- Main Navigation Structure Definition ---
export const appNavigationStructure: NavigatorLayout[] = [
    {
        type: 'stack',
        name: 'Root',
        stackNavigatorOptions: {
            // Props for the Root <Stack.Navigator>
            initialRouteName: '(drawer)',
            screenOptions: {
                // Default screen options for screens within Root Stack
                headerShown: false,
            }, // This should now be valid
        },
        screens: [
            {
                type: 'drawer',
                name: '(drawer)',
                options: {
                    // Options for (drawer) *as a screen* within the 'Root' Stack
                    headerShown: false,
                },
                drawerNavigatorOptions: {
                    // Props for the <Drawer.Navigator> for '(drawer)'
                    initialRouteName: '(tabs)',
                    defaultStatus: 'closed',
                    drawerStyle: {
                        backgroundColor: 'white',
                        width: 280,
                    },
                    overlayColor: 'rgba(0, 0, 0, 0.5)',
                    screenOptions: {
                        // Default screen options for screens *within* this Drawer
                        headerShown: true,
                    }, // This was already correct
                },
                screens: [
                    {
                        type: 'tabs',
                        name: '(tabs)',
                        showOn: ['mobile'],
                        options: {
                            // Options for (tabs) *as a screen/item* within the '(drawer)'
                            title: 'Vidream Main',
                            drawerLabel: 'Dashboard',
                            drawerItemStyle: { display: 'none' },
                        },
                        tabNavigatorOptions: {
                            // Props for the <Tabs.Navigator> for '(tabs)'
                            initialRouteName: '(home)/index',
                            screenOptions: {
                                // Default screen options for screens *within* these Tabs
                                headerShown: false,
                            }, // This should now be valid
                        },
                        screens: []
                    }
                ]
            },
        ],
    },
];
// --- Utility Function to Find Navigator Configuration ---
export function findNavigatorLayout(name: string, structure: NavigationSchemaItem[] = appNavigationStructure as NavigationSchemaItem[]): NavigationSchemaItem | undefined {
    for (const item of structure) {
        if (item.name === name) {
            return item;
        }
        if (item.type === 'stack' ||
            item.type === 'drawer' ||
            item.type === 'tabs') {
            const navigatorItem = item as StackNavigatorLayoutConfig | DrawerNavigatorLayoutConfig | TabNavigatorLayoutConfig;
            if (navigatorItem.screens) {
                const foundInChild = findNavigatorLayout(name, navigatorItem.screens);
                if (foundInChild) {
                    return foundInChild;
                }
            }
        }
    }
    return undefined;
}
