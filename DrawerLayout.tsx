import React from "react";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { MainStack } from "./MainStack";
import { AboutPage } from "./About"; // Assuming you still want a direct link

const Drawer = createDrawerNavigator();

export function DrawerLayout() {
  return (
    // The Drawer is now the parent navigator
    <Drawer.Navigator
      screenOptions={{
        // Hide the Drawer's own header.
        // We will use the header from the Stack Navigator inside.
        headerShown: false,
      }}
    >
      <Drawer.Screen
        name="Main"
        component={MainStack}
        options={{
          title: "Home", // This title will be used in the drawer list
        }}
      />
      <Drawer.Screen
        name="About"
        component={AboutPage}
        options={{
          title: "About",
        }}
      />
    </Drawer.Navigator>
  );
}
// import React from "react";
// import {
//   createDrawerNavigator,
//   // DrawerNavigationOptions,
// } from "@react-navigation/drawer";
// // import { StyleSheet } from "react-native"; // Using react-native for consistency

// // Import the page components for other drawer screens
// import { HomePage } from "./Home";
// import { AboutPage } from "./About";

// const Drawer = createDrawerNavigator();

// export function DrawerLayout() {
//   // const colorScheme = useColorScheme(); // For theming if needed

//   return (
//     <Drawer.Navigator
//       initialRouteName="Home"
//       screenOptions={{
//         headerShown: true,
//       }}
//     >
//       <Drawer.Screen
//         name="Home"
//         component={HomePage}
//         options={{
//           title: "Home",
//           drawerLabel: "Home",
//         }}
//       />
//       <Drawer.Screen
//         name="About"
//         component={AboutPage}
//         options={{
//           title: "About",
//           drawerLabel: "About",
//         }}
//       />
//     </Drawer.Navigator>
//   );
// }

// const styles = StyleSheet.create({
//   headerButton: {
//     paddingHorizontal: 15,
//     justifyContent: "center",
//     height: "100%",
//   },
//   iconText: {
//     fontSize: 18,
//     color: "#007AFF",
//   },
//   container: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   title: {
//     fontSize: 24,
//     fontWeight: "bold",
//   },
// });
