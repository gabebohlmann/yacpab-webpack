<!-- README.md -->

# React Native Cli - Webpack

## Description

Basic starter template, showing how to correctly configure React Native Web using React Native Cli, using webpack and typescript.

### Upgrade to React 19

This branch has been upgraded to react@19 and react-navigation@7 along with all other dependencies to their latest compatible verisons. Switch to the main branch for react@18 and react-navigation@6. \* upgrading from react@18 to react@19 manually requires adding this snippet to `module.rules` in `webpack.config.js`

```js
    module: {
      rules: [
        {
          test: /\.m?js$/,
          include: [
            path.resolve(
              __dirname,
              "node_modules/@react-navigation/core/lib/module"
            ),
            path.resolve(
              __dirname,
              "node_modules/@react-navigation/elements/lib/module"
            ),
            path.resolve(
              __dirname,
              "node_modules/@react-navigation/native/lib/module"
            ),
            path.resolve(
              __dirname,
              "node_modules/@react-navigation/native-stack/lib/module"
            ),
            // bottom-tabs doesn't error but is included for consistendcy
            path.resolve(
              __dirname,
              "node_modules/@react-navigation/bottom-tabs/lib/module"
            ),
                        path.resolve(
              __dirname,
              "node_modules/@react-navigation/drawer/lib/module"
            ),
          ],
          resolve: {
            fullySpecified: false, // fix for @react-navigation@7 errors
          },
        },
```

## Steps to install template

1. Run in terminal
   ```sh
     git clone https://github.com/gabriel-logan/react-native-web-webpack-template.git <YOUR_PROJECT_NAME>
   ```
1. Change `webpack.Configuration.output.publicPath` in `webpack.config.js` from `"./"` to `"/"`
   - The `.` is needed for GitHub pages deployment
1. Update the `"name"` field in `package.json` to `<YOUR_PROJECT_NAME>` to match your project's folder name
1. Run in terminal at project root
   ```sh
     yarn
   ```
   - `yarn` is recommended for its tooling for monorepos and dependency resolution. `react-native-web` dependencies can be much harded to deal with on `npm`
1. Run in terminal at project root
   ```sh
     yarn web
   ```

## Installation from Scratch with RN CLI

First install React Native, if you already have it installed, skip this step.

```sh
npx @react-native-community/cli@latest init web
```

Run

```sh
cd web/
```

Now install react native web and its dependencies

```sh
yarn add react-dom react-native-web
```

The Babel plugin is recommended for build-time optimizations.

```sh
yarn add -D babel-plugin-react-native-web
```

Install `webpack` dependencies

```sh
yarn add -D webpack webpack-cli webpack-dev-server html-webpack-plugin babel-loader babel-plugin-module-resolver url-loader @svgr/webpack
```

## Configuration files

Add the necessary scripts to run the project to your `package.json`

```json
"build:web": "rm -rf dist/ && webpack --mode=production --config webpack.config.js --progress",
"web": "webpack serve --mode=development --config webpack.config.js --progress",
```

```json
"scripts": {
  "android": "react-native run-android",
  "ios": "react-native run-ios",
  "build:web": "rm -rf dist/ && webpack --mode=production --config webpack.config.js --progress", // This line for build project
  "web": "webpack serve --mode=development --config webpack.config.js --progress", // This line for dev mode
  "lint": "eslint .",
  "start": "react-native start",
  "test": "jest"
},
```

Copy the code to `App.tsx`

If you want to have separate web files, create an App.web.tsx file and replace all the values ​​from the following steps.

```js
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Hello World!</Text>
      <Text style={styles.subTitle}>React Native Web</Text>
      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>Press Me</Text>
      </TouchableOpacity>
      <Text>
        Created by:{" "}
        <TouchableOpacity
          onPress={() => {
            Linking.openURL("https://github.com/gabriel-logan");
          }}
        >
          <Text style={styles.link}>Gabriel Logan</Text>
        </TouchableOpacity>{" "}
        using{" "}
        <TouchableOpacity
          onPress={() => {
            Linking.openURL("https://necolas.github.io/react-native-web/");
          }}
        >
          <Text style={styles.link}>React Native Web</Text>
        </TouchableOpacity>
        , Webpack and TypeScript
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, alignItems: "center" },
  button: {
    backgroundColor: "#ADBDFF",
    padding: 10,
    marginVertical: 20,
    borderRadius: 5,
  },
  buttonText: { fontSize: 20 },
  title: { fontSize: 40 },
  subTitle: { fontSize: 20 },
  paragraph: { fontSize: 16 },
  link: { color: "blue", textDecorationLine: "underline" },
});

export default App;
```

Create a file called `index.html` in the root folder of your project

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <meta name="description" content="React Native Web" />
    <title>React Native Web</title>
    <style>
      #app-root {
        display: flex;
        flex: 1 1 100%;
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="app-root"></div>
  </body>
</html>
```

Now create a file in the root folder named `index.web.js`

Paste the code below

```js
import { AppRegistry } from "react-native";

import App from "./web/app/App.tsx;
import { name as appName } from "./app.json";
if (module.hot) {
  module.hot.accept();
}
AppRegistry.registerComponent(appName, () => App);
AppRegistry.runApplication(appName, {
  initialProps: {},
  rootTag: document.getElementById("app-root"),
});
```

Now create a webpack configuration file `webpack.config.js` in the root folder

and paste the code below

```js
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");

const appDirectory = path.resolve(__dirname);
const { presets, plugins } = require(`${appDirectory}/babel.config.web.js`);

const compileNodeModules = [
  // Add every react-native package that needs compiling
  // 'react-native-gesture-handler',
].map((moduleName) => path.resolve(appDirectory, `node_modules/${moduleName}`));

const babelLoaderConfiguration = {
  test: /\.js$|tsx?$/,
  // Add every directory that needs to be compiled by Babel during the build.
  include: [
    path.resolve(__dirname, "index.web.js"), // Entry to your application
    path.resolve(__dirname, "App.tsx"), // Change this to your main App file
    path.resolve(__dirname, "src"),
    ...compileNodeModules,
  ],
  use: {
    loader: "babel-loader",
    options: { cacheDirectory: true, presets, plugins },
  },
};

const svgLoaderConfiguration = {
  test: /\.svg$/,
  use: [{ loader: "@svgr/webpack" }],
};

const imageLoaderConfiguration = {
  test: /\.(gif|jpe?g|png)$/,
  use: { loader: "url-loader", options: { name: "[name].[ext]" } },
};

/** @type {import("webpack").Configuration} */
module.exports = {
  entry: { app: path.join(__dirname, "index.web.js") },
  output: {
    path: path.resolve(appDirectory, "dist"),
    publicPath: "/", // Using ./ for the github pages, change to / for local
    filename: "rnw.bundle.js",
  },
  resolve: {
    extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.js", ".js"],
    alias: { "react-native$": "react-native-web" },
  },
  module: {
    rules: [
      babelLoaderConfiguration,
      imageLoaderConfiguration,
      svgLoaderConfiguration,
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: path.join(__dirname, "index.html") }),
    new webpack.HotModuleReplacementPlugin(),
    new webpack.DefinePlugin({
      // See: https://github.com/necolas/react-native-web/issues/349
      __DEV__: JSON.stringify(true),
    }),
  ],
};
```

Create a new babel file so there are no conflicts with the mobile version

Add settings to `babel.config.web.js`

```js
module.exports = {
  presets: ["module:@react-native/babel-preset"],
  plugins: [
    ["module-resolver", { alias: { "^react-native$": "react-native-web" } }],
    "react-native-web",
  ],
};
```

If you need to create tests using `jest` add the configuration below to your test file

```js
moduleNameMapper: {
   "^react-native$": "react-native-web",
},
```

## Additional

To copy public static files to production, add an additional configuration in `webpack`

```sh
yarn add -D copy-webpack-plugin
```

Import the configuration into your `webpack` configuration file

```js
const CopyWebpackPlugin = require("copy-webpack-plugin");
```

and finally add the configuration in the `plugin` part

```js
plugins: [
  new HtmlWebpackPlugin({
    template: path.join(__dirname, "index.html"),
  }),
  new webpack.HotModuleReplacementPlugin(),
  new webpack.DefinePlugin({
    // See: https://github.com/necolas/react-native-web/issues/349
    __DEV__: JSON.stringify(true),
  }),
  new CopyWebpackPlugin({ // ADD THIS LINE
    patterns: [{ from: "public", to: "" }],
  }),
],
```

With these settings, all files inside the `public` folder will be compiled together to the `dist` folder.

Now you can add a favicon for example in the `public/assets/favicon.png` folder

And add it to your `index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="ie=edge" />
    <meta name="description" content="React Native Web" />
    <link rel="icon" href="./assets/favicon.png" />
    <title>React Native Web</title>
    <style>
      #app-root {
        display: flex;
        flex: 1 1 100%;
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="app-root"></div>
  </body>
</html>
```

Now you will see your favicon appearing in development mode as well as in production.

## Done

Your react native web project configured with webpack is ready for the initial kickstart

Thanks for reading

Created by: Gabriel Logan using React Native Web

## @react-navigation

Follow the manual installation documentation for @react-navigation/native which is required to use React Navigation

https://reactnavigation.org/docs/getting-started/

Then use one of the Navigators you intend to use.

For example: Native Stack Navigator

https://reactnavigation.org/docs/native-stack-navigator

Read the information about web support

https://reactnavigation.org/docs/web-support

The Example without React Navigation can be found in the docs folder

If you want to test with React Navigation, you can git clone the main repository.

## License

MIT
