// apps/web/index.web.js
import { AppRegistry } from "react-native";

import RootLayout from "./app";
import { name as appName } from "../../app.json";

if (module.hot) {
  module.hot.accept();
}

AppRegistry.registerComponent(appName, () => RootLayout);
AppRegistry.runApplication(appName, {
  initialProps: {},
  rootTag: document.getElementById("app-root"),
});
