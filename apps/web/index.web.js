// apps/web/index.web.js
// index.web.js
import { AppRegistry } from "react-native";

import App from "./app/App";
import { name as appName } from "../../app.json";

if (module.hot) {
  module.hot.accept();
}

AppRegistry.registerComponent(appName, () => App);
AppRegistry.runApplication(appName, {
  initialProps: {},
  rootTag: document.getElementById("app-root"),
});
