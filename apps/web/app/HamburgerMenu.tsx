// HamburgerMenu.tsx
import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { useNavigation, DrawerActions } from "@react-navigation/native";

export function HamburgerMenu() {
  const navigation = useNavigation();

  const toggleDrawer = () => {
    navigation.dispatch(DrawerActions.toggleDrawer());
  };

  return (
    <Pressable onPress={toggleDrawer} hitSlop={20} style={styles.headerButton}>
      <Text style={styles.iconText}>☰</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerButton: {
    paddingHorizontal: 15,
    justifyContent: "center",
    height: "100%",
  },
  iconText: {
    fontSize: 22,
    color: "#007AFF", // Feel free to style this as you like
  },
}); 