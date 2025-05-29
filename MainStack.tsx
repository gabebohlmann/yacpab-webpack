// MainStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomePage } from "./Home";
import { AboutPage } from "./About";
import { HamburgerMenu } from "./HamburgerMenu"; // <--- 1. Import our new component

const Stack = createNativeStackNavigator();

export function MainStack() {
  return (
    <Stack.Navigator
      // 2. Add screenOptions to configure all screens in this stack
      screenOptions={{
        headerLeft: () => <HamburgerMenu />, // <--- 3. Set headerLeft to our component
      }}
    >
      <Stack.Screen
        name="Home"
        component={HomePage}
        options={{ title: "React Native Web App" }}
      />
      <Stack.Screen name="About" component={AboutPage} />
    </Stack.Navigator>
  );
}