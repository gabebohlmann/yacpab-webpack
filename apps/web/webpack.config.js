// apps/web/webpack.config.js
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");

const appDirectory = path.resolve(__dirname);
const monorepoRoot = path.resolve(__dirname, '../..');
const { presets, plugins } = require("../../babel.config.js");
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');
const { TanStackRouterWebpack } = require('@tanstack/router-plugin/webpack')

const compileNodeModules = [
  // Add every react-native package that needs compiling
  "react-native-reanimated",
  "react-native-gesture-handler",
].map((moduleName) => path.resolve(monorepoRoot, `node_modules/${moduleName}`));

const babelLoaderConfiguration = {
  test: /\.js$|tsx?$/,
  // Add every directory that needs to be compiled by Babel during the build.
  include: [
    path.resolve(__dirname, "index.web.js"),
    path.resolve(__dirname, "app/App.tsx"),
    path.resolve(__dirname, "src"),
    // path.resolve(__dirname, "web/app/DrawerLayout.tsx"),
    // path.resolve(__dirname, "web/app/Home.tsx"),
    // path.resolve(__dirname, "web/app/About.tsx"),
    // path.resolve(__dirname, "web/app/MainStack.tsx"),
    // path.resolve(__dirname, "web/app/HamburgerMenu.tsx"),
    path.resolve(__dirname, "app"),
    path.resolve(monorepoRoot, "packages/core/features"),
    path.resolve(monorepoRoot, "packages/config"),
    ...compileNodeModules
    // ...compileNodeModules.map((moduleName) => path.resolve(__dirname, `../../node_modules/${moduleName}`)),
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
    path: path.resolve(appDirectory, "../../dist"),
    publicPath: "/",
    filename: "[name].[contenthash].js",
  },
  resolve: {
    extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".web.js", ".js"],
    alias: { "react-native$": "react-native-web" },
    plugins: [
      new TsconfigPathsPlugin({
        configFile: path.resolve(monorepoRoot, 'tsconfig.json'),
      })
    ],
  },
  module: {
    rules: [
      babelLoaderConfiguration,
      imageLoaderConfiguration,
      svgLoaderConfiguration,
      // This rule handles modules that use extension-less imports
      {
        test: /\.m?js$/,
        include: [
          path.resolve(
            monorepoRoot,
            "node_modules/@react-navigation/core/lib/module"
          ),
          path.resolve(
            monorepoRoot,
            "node_modules/@react-navigation/elements/lib/module"
          ),
          path.resolve(
            monorepoRoot,
            "node_modules/@react-navigation/native/lib/module"
          ),
          path.resolve(
            monorepoRoot,
            "node_modules/@react-navigation/native-stack/lib/module"
          ),
          // not necessary but included for consistency, and bug fix PR
          path.resolve(
            monorepoRoot,
            "node_modules/@react-navigation/bottom-tabs/lib/module"
          ),
          path.resolve(
            monorepoRoot,
            "node_modules/@react-navigation/drawer/lib/module"
          ),
          path.resolve(
            monorepoRoot,
            "node_modules/react-native-drawer-layout/lib/module"
          ),
        ],
        resolve: { fullySpecified: false },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: path.join(__dirname, "index.html") }),
    new webpack.HotModuleReplacementPlugin(),
    new webpack.DefinePlugin({ __DEV__: JSON.stringify(true) }),
    new CopyWebpackPlugin({ patterns: [{ from: "public", to: "" }] }),
    // new TsconfigPathsPlugin(),
    TanStackRouterWebpack({ target: 'react', autoCodeSplitting: true }),
  ],
  optimization: { splitChunks: { chunks: "all" } },
  performance: { maxAssetSize: 512000, maxEntrypointSize: 512000 },
};
