/**
 * @format
 */

import { AppRegistry } from "react-native";

import App from "./web/app/App.tsx;
import { name as appName } from "./app.json";

AppRegistry.registerComponent(appName, () => App);
