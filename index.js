// apps/web/index.js
// index.js
/**
 * @format
 */

import { AppRegistry } from "react-native";

import App from ".app";
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
