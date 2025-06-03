#!/usr/bin/env node

const chokidar = require("chokidar");
const fs = require("fs-extra");
const path = require("path");
const inquirer = require("inquirer");
const simpleGit = require("simple-git");
const ts = require("typescript");

// Determine MONOREPO_ROOT
const MONOREPO_ROOT = process.cwd();
console.log(`CLI operating with MONOREPO_ROOT: ${MONOREPO_ROOT}`);

const git = simpleGit({ baseDir: MONOREPO_ROOT });

const NAVIGATION_CONFIG_PATH = path.join(
  MONOREPO_ROOT,
  "packages/config/navigation/layout.tsx"
);
const FEATURES_PATH = path.join(MONOREPO_ROOT, "packages/core/features");
const EXPO_APP_PATH = path.join(MONOREPO_ROOT, "apps/expo/app");
const WEB_APP_PATH = path.join(MONOREPO_ROOT, "apps/web/app");

let lastAcknowledgedConfigState = null;
let actionInProgress = false;
let ignoreNextConfigChange = false;
let reevaluateAfterCompletion = false;
let editingModeActive = false;

function capitalizeFirstLetter(string) {
  if (!string) return "";
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// --- AST Helper Functions ---
function findAppNavigationStructureDeclaration(sourceFile) {
  let appNavDeclaration = null;
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.name.text === "appNavigationStructure"
        ) {
          appNavDeclaration = decl;
          break;
        }
      }
    }
    if (!appNavDeclaration) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return appNavDeclaration;
}

function createScreenAstNode(factory, screenDetails) {
  const optionsProperties = [
    factory.createPropertyAssignment(
      "title",
      factory.createStringLiteral(
        screenDetails.title || capitalizeFirstLetter(screenDetails.name)
      )
    ),
  ];

  // Add properties specific to the parent type
  if (screenDetails.parentType === "tabs") {
    optionsProperties.push(
      factory.createPropertyAssignment(
        "tabBarIconName",
        factory.createStringLiteral(
          screenDetails.icon || screenDetails.name.toLowerCase()
        )
      )
    );
    if (screenDetails.label) {
      optionsProperties.push(
        factory.createPropertyAssignment(
          "tabBarLabel",
          factory.createStringLiteral(screenDetails.label)
        )
      );
    }
  } else if (screenDetails.parentType === "drawer") {
    optionsProperties.push(
      factory.createPropertyAssignment(
        "drawerLabel",
        factory.createStringLiteral(
          screenDetails.label || capitalizeFirstLetter(screenDetails.name)
        )
      )
    );
    // You might want to add drawerIcon or other drawer-specific options here if needed
  }

  // Ensure href is always present, defaulting if necessary
  const href =
    screenDetails.href ||
    `/${screenDetails.parentName === "(root)" ? "" : screenDetails.parentName + "/"}${screenDetails.name}`;

  return factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment(
        "type",
        factory.createStringLiteral("screen")
      ),
      factory.createPropertyAssignment(
        "name",
        factory.createStringLiteral(screenDetails.name)
      ),
      factory.createPropertyAssignment(
        "component",
        factory.createIdentifier(screenDetails.componentName)
      ),
      factory.createPropertyAssignment(
        "href",
        factory.createStringLiteral(href)
      ),
      factory.createPropertyAssignment(
        "options",
        factory.createObjectLiteralExpression(optionsProperties, true)
      ),
    ],
    true
  );
}
// --- End AST Helper Functions ---

async function parseNavigationConfig(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, "utf-8");
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      fileContent,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX
    );

    let isAutoSaveOn = false;
    let isEditing = false;
    let commandsToExecute = { add: [], delete: [] };
    const parsedScreens = [];

    function extractScreensRecursive(navigatorNode, parentInfo) {
      if (!ts.isObjectLiteralExpression(navigatorNode)) return;

      const screensProp = navigatorNode.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === "screens"
      );
      if (
        !screensProp ||
        !ts.isPropertyAssignment(screensProp) ||
        !ts.isArrayLiteralExpression(screensProp.initializer)
      )
        return;

      screensProp.initializer.elements.forEach((elementNode) => {
        if (ts.isObjectLiteralExpression(elementNode)) {
          const typeProp = elementNode.properties.find(
            (p) =>
              p.name?.getText(sourceFile) === "type" &&
              ts.isPropertyAssignment(p) &&
              ts.isStringLiteral(p.initializer)
          );
          const nameProp = elementNode.properties.find(
            (p) =>
              p.name?.getText(sourceFile) === "name" &&
              ts.isPropertyAssignment(p) &&
              ts.isStringLiteral(p.initializer)
          );

          if (!typeProp || !nameProp) return;

          const type = typeProp.initializer.text;
          const name = nameProp.initializer.text;

          if (type === "screen") {
            const screen = { parent: parentInfo, name };
            elementNode.properties.forEach((prop) => {
              if (ts.isPropertyAssignment(prop) && prop.name) {
                const propName = prop.name.getText(sourceFile);
                const propValueNode = prop.initializer;
                if (propName === "component" && ts.isIdentifier(propValueNode))
                  screen.componentName = propValueNode.text;
                if (propName === "href" && ts.isStringLiteral(propValueNode))
                  screen.href = propValueNode.text;
                if (
                  propName === "options" &&
                  ts.isObjectLiteralExpression(propValueNode)
                ) {
                  propValueNode.properties.forEach((optProp) => {
                    if (ts.isPropertyAssignment(optProp) && optProp.name) {
                      const optName = optProp.name.getText(sourceFile);
                      if (ts.isStringLiteral(optProp.initializer)) {
                        if (optName === "title")
                          screen.title = optProp.initializer.text;
                        if (optName === "tabBarIconName")
                          screen.icon = optProp.initializer.text;
                        if (optName === "drawerLabel")
                          screen.label = optProp.initializer.text;
                        if (optName === "tabBarLabel")
                          screen.label = optProp.initializer.text;
                      }
                    }
                  });
                }
              }
            });
            if (screen.name && screen.componentName) parsedScreens.push(screen);
          } else if (type === "tabs" || type === "drawer" || type === "stack") {
            extractScreensRecursive(elementNode, { name, type });
          }
        }
      });
    }

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach((declaration) => {
          if (ts.isIdentifier(declaration.name)) {
            const varName = declaration.name.text;
            if (declaration.initializer) {
              if (varName === "isAutoSaveEnabled") {
                isAutoSaveOn =
                  declaration.initializer.kind === ts.SyntaxKind.TrueKeyword;
              } else if (varName === "isEditing") {
                isEditing =
                  declaration.initializer.kind === ts.SyntaxKind.TrueKeyword;
              } else if (
                varName === "commandsToExecute" &&
                ts.isObjectLiteralExpression(declaration.initializer)
              ) {
                declaration.initializer.properties.forEach((prop) => {
                  if (
                    ts.isPropertyAssignment(prop) &&
                    ts.isIdentifier(prop.name)
                  ) {
                    const commandType = prop.name.text;
                    if (
                      (commandType === "add" || commandType === "delete") &&
                      ts.isArrayLiteralExpression(prop.initializer)
                    ) {
                      commandsToExecute[commandType] = [];
                      prop.initializer.elements.forEach((elementNode) => {
                        if (ts.isObjectLiteralExpression(elementNode)) {
                          const commandArg = {};
                          elementNode.properties.forEach((cmdProp) => {
                            if (
                              ts.isPropertyAssignment(cmdProp) &&
                              ts.isIdentifier(cmdProp.name) &&
                              cmdProp.initializer
                            ) {
                              const cmdPropName = cmdProp.name.text;
                              if (
                                ts.isStringLiteral(cmdProp.initializer) ||
                                (ts.isIdentifier(cmdProp.initializer) &&
                                  typeof cmdProp.initializer.text === "string")
                              ) {
                                commandArg[cmdPropName] =
                                  cmdProp.initializer.text;
                              } else if (
                                cmdProp.initializer.kind ===
                                ts.SyntaxKind.TrueKeyword
                              ) {
                                commandArg[cmdPropName] = true;
                              } else if (
                                cmdProp.initializer.kind ===
                                ts.SyntaxKind.FalseKeyword
                              ) {
                                commandArg[cmdPropName] = false;
                              }
                            }
                          });
                          if (commandArg.name) {
                            commandsToExecute[commandType].push(commandArg);
                          }
                        }
                      });
                    }
                  }
                });
              }
            }
          }
        });
      }
    });

    const appNavDeclaration = findAppNavigationStructureDeclaration(sourceFile);
    if (
      appNavDeclaration &&
      appNavDeclaration.initializer &&
      ts.isArrayLiteralExpression(appNavDeclaration.initializer)
    ) {
      appNavDeclaration.initializer.elements.forEach((rootNavNode) => {
        if (ts.isObjectLiteralExpression(rootNavNode)) {
          const nameProp = rootNavNode.properties.find(
            (p) => p.name?.getText(sourceFile) === "name"
          );
          const rootName =
            nameProp &&
            ts.isPropertyAssignment(nameProp) &&
            ts.isStringLiteral(nameProp.initializer)
              ? nameProp.initializer.text
              : "Root";
          const typeProp = rootNavNode.properties.find(
            (p) => p.name?.getText(sourceFile) === "type"
          );
          const rootType =
            typeProp &&
            ts.isPropertyAssignment(typeProp) &&
            ts.isStringLiteral(typeProp.initializer)
              ? typeProp.initializer.text
              : "stack";
          extractScreensRecursive(rootNavNode, {
            name: rootName,
            type: rootType,
          });
        }
      });
    } else {
      console.warn(
        "Could not find 'appNavigationStructure' or it's not an array. Screen parsing might be incomplete."
      );
    }

    return {
      screens: parsedScreens,
      isAutoSaveOn,
      isEditing,
      commandsToExecute,
      sourceFile,
    };
  } catch (error) {
    console.error("Error parsing navigation config:", error.message);
    if (error instanceof SyntaxError || error.message.includes("SyntaxError")) {
      console.warn(
        "Syntax error in navigation config, likely due to autosave. Skipping this change."
      );
      return null;
    }
    return null;
  }
}

function identifyChanges(currentConfigScreens, previousConfigScreens) {
  const newScreens = [];
  const deletedScreens = [];
  const updatedScreens = [];
  const renamedScreens = [];

  const currentScreenMap = new Map(
    currentConfigScreens?.map((s) => [`${s.parent.name}-${s.name}`, s]) || []
  );
  const previousScreenMap = new Map(
    previousConfigScreens?.map((s) => [`${s.parent.name}-${s.name}`, s]) || []
  );

  const processedAsRenameNewKeys = new Set();
  const processedAsRenameOldKeys = new Set();

  for (const [prevKey, prevScreen] of previousScreenMap) {
    if (!currentScreenMap.has(prevKey)) {
      for (const [currKey, currScreen] of currentScreenMap) {
        if (
          !previousScreenMap.has(currKey) &&
          currScreen.componentName === prevScreen.componentName &&
          !processedAsRenameNewKeys.has(currKey)
        ) {
          renamedScreens.push({ oldScreen: prevScreen, newScreen: currScreen });
          processedAsRenameOldKeys.add(prevKey);
          processedAsRenameNewKeys.add(currKey);
          break;
        }
      }
    }
  }

  for (const [key, currentScreen] of currentScreenMap) {
    if (previousScreenMap.has(key) && !processedAsRenameNewKeys.has(key)) {
      const previousScreen = previousScreenMap.get(key);
      const relevantPropsChanged =
        currentScreen.componentName !== previousScreen.componentName ||
        currentScreen.title !== previousScreen.title ||
        currentScreen.icon !== previousScreen.icon ||
        currentScreen.label !== previousScreen.label ||
        currentScreen.href !== previousScreen.href;
      if (relevantPropsChanged) {
        updatedScreens.push({
          oldScreen: previousScreen,
          newScreen: currentScreen,
        });
      }
    }
  }

  for (const [key, currentScreen] of currentScreenMap) {
    if (!previousScreenMap.has(key) && !processedAsRenameNewKeys.has(key)) {
      newScreens.push(currentScreen);
    }
  }

  for (const [key, previousScreen] of previousScreenMap) {
    if (!currentScreenMap.has(key) && !processedAsRenameOldKeys.has(key)) {
      deletedScreens.push(previousScreen);
    }
  }
  return { newScreens, deletedScreens, updatedScreens, renamedScreens };
}

// --- File System Functions (Updated for dynamic paths and Expo folder structure) ---
function getScreenPaths(screenName, parent) {
  // The "base name" for features strips parentheses. e.g., '(home)' -> 'home'
  const baseName = screenName.replace(/^\(|\)$/g, "");

  const featurePath = path.join(FEATURES_PATH, baseName);

  if (!parent || !parent.name || !parent.type) {
    console.warn(
      `Parent info incomplete for screen '${screenName}'. File paths might be incorrect.`
    );
    return { featurePath };
  }

  let expoParentPathSegments = [];
  let webParentPathSegments = [];

  if (parent.name === "(drawer)") {
    expoParentPathSegments.push("(drawer)");
    webParentPathSegments.push("(drawer)");
  } else if (parent.name === "(tabs)") {
    expoParentPathSegments.push("(drawer)", "(tabs)");
    webParentPathSegments.push("(drawer)", "(tabs)");
  } else if (parent.name === "Root" && parent.type === "stack") {
    // No specific sub-folder for Root itself
  } else {
    expoParentPathSegments.push(parent.name);
    webParentPathSegments.push(parent.name);
  }

  const expoParentDir = path.join(EXPO_APP_PATH, ...expoParentPathSegments);
  const webParentDir = path.join(WEB_APP_PATH, ...webParentPathSegments);

  // KEY CHANGE: Assume EVERY screenName corresponds to a directory.
  // screenName is 'account' or '(home)', which is used for the directory name.
  const routeDir = path.join(expoParentDir, screenName);
  const webPageDir = path.join(webParentDir, screenName);

  return {
    featurePath: featurePath,
    // For deletion/moving, we always act on the entire directory
    expoScreenDir: routeDir,
    // The file path is ALWAYS index.tsx inside that directory
    expoFilePath: path.join(routeDir, "index.tsx"),
    webPageDir: webPageDir,
    webPagePath: path.join(webPageDir, "page.tsx"),
  };
}

async function generateFeatureScreen(
  screenName,
  componentName,
  title,
  isUpdateOrRename = false,
  autoConfirm = false
) {
  const { featurePath } = getScreenPaths(screenName, {});
  const screenFilePath = path.join(featurePath, "screen.tsx");
  const promptAction = isUpdateOrRename ? "Update/overwrite" : "Overwrite";

  if ((await fs.pathExists(screenFilePath)) && !autoConfirm) {
    const { overwrite } = await inquirer.default.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `Feature screen file ${screenFilePath} exists. ${promptAction}?`,
        default: isUpdateOrRename,
      },
    ]);
    if (!overwrite) {
      console.log(`Skipped ${promptAction}: ${screenFilePath}`);
      return null;
    }
  }

  await fs.ensureDir(featurePath);
  const content = `// #features/${screenName}/screen.tsx
'use client';
import { View, Text } from 'react-native';
import { useColorScheme } from "react-native";

export function ${componentName}() {
  const colorScheme = useColorScheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: colorScheme === 'dark' ? '#121212' : '#FFFFFF' }}>
      <Text style={{ fontSize: 24, marginBottom: 10, color: colorScheme === 'dark' ? 'white' : 'black' }}>
        ${title || screenName}
      </Text>
      <Text style={{ fontSize: 12, color: colorScheme === 'dark' ? 'white' : 'black' }}>
        This screen was ${isUpdateOrRename ? "updated/regenerated" : "auto-generated"} by the CLI.
      </Text>
    </View>
  );
}`;
  await fs.writeFile(screenFilePath, content);
  console.log(
    `${isUpdateOrRename ? "Updated/Regenerated" : "Generated"}: ${screenFilePath}`
  );
  return screenFilePath;
}

async function generateExpoFile(
  screenName,
  componentName,
  parent,
  isUpdateOrRename = false,
  autoConfirm = false
) {
  const { expoFilePath, expoScreenDir } = getScreenPaths(screenName, parent);
  // Get the clean base name for the template: "(home)" -> "home"
  const baseName = screenName.replace(/^\(|\)$/g, "");

  if (!expoFilePath || !expoScreenDir) {
    console.warn(`Could not determine Expo path for ${screenName}.`);
    return null;
  }

  const promptAction = isUpdateOrRename ? "Update/overwrite" : "Overwrite";

  if ((await fs.pathExists(expoFilePath)) && !autoConfirm) {
    const { overwrite } = await inquirer.default.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `Expo file ${expoFilePath} exists. ${promptAction}?`,
        default: isUpdateOrRename,
      },
    ]);
    if (!overwrite) {
      console.log(`Skipped ${promptAction}: ${expoFilePath}`);
      return null;
    }
  }

  await fs.ensureDir(expoScreenDir);
  const content = `// #features/${baseName}/screen.tsx
import { ${componentName} } from '#features/${baseName}/screen';

export default function ${capitalizeFirstLetter(baseName)}Route() {
return <${componentName} />;
}`;
  await fs.writeFile(expoFilePath, content);
  console.log(
    `${isUpdateOrRename ? "Updated/Regenerated" : "Generated"}: ${expoFilePath}`
  );
  return expoFilePath;
}

async function generateWebFile(
  screenName,
  componentName,
  parent,
  isUpdateOrRename = false,
  autoConfirm = false
) {
  const { webPagePath, webPageDir } = getScreenPaths(screenName, parent);
  // Get the clean base name for the template: "(home)" -> "home"
  const baseName = screenName.replace(/^\(|\)$/g, "");

  if (!webPagePath || !webPageDir) {
    console.warn(`Could not determine Web path for ${screenName}.`);
    return null;
  }

  const promptAction = isUpdateOrRename ? "Update/overwrite" : "Overwrite";

  if ((await fs.pathExists(webPagePath)) && !autoConfirm) {
    const { overwrite } = await inquirer.default.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: `Web file ${webPagePath} exists. ${promptAction}?`,
        default: isUpdateOrRename,
      },
    ]);
    if (!overwrite) {
      console.log(`Skipped ${promptAction}: ${webPagePath}`);
      return null;
    }
  }

  await fs.ensureDir(webPageDir);
  const content = `// ${path.relative(MONOREPO_ROOT, webPagePath)}
'use client';
import { ${componentName} } from '#features/${baseName}/screen';

export default function ${capitalizeFirstLetter(baseName)}Page() {
return <${componentName} />;
}`;
  await fs.writeFile(webPagePath, content);
  console.log(
    `${isUpdateOrRename ? "Updated/Regenerated" : "Generated"}: ${webPagePath}`
  );
  return webPagePath;
}

async function deleteScreenFiles(screenName, parent) {
  const { featurePath, expoScreenDir, webPageDir } = getScreenPaths(
    screenName,
    parent
  );
  const deletedPaths = [];

  if (await fs.pathExists(featurePath)) {
    await fs.remove(featurePath);
    console.log(`Deleted feature: ${featurePath}`);
    deletedPaths.push(featurePath);
  }
  if (expoScreenDir && (await fs.pathExists(expoScreenDir))) {
    await fs.remove(expoScreenDir);
    console.log(`Deleted Expo screen directory: ${expoScreenDir}`);
    deletedPaths.push(expoScreenDir);
  }
  if (webPageDir && (await fs.pathExists(webPageDir))) {
    await fs.remove(webPageDir);
    console.log(`Deleted Web directory: ${webPageDir}`);
    deletedPaths.push(webPageDir);
  }
  return deletedPaths;
}

async function renameScreenFiles(oldScreen, newScreen) {
  const { featurePath: oldFeaturePath, expoScreenDir: oldExpoScreenDir } =
    getScreenPaths(oldScreen.name, oldScreen.parent);
  const { webPageDir: oldWebDir } = getScreenPaths(
    oldScreen.name,
    oldScreen.parent
  );

  const { featurePath: newFeaturePath, expoScreenDir: newExpoScreenDir } =
    getScreenPaths(newScreen.name, newScreen.parent);
  const { webPageDir: newWebDir } = getScreenPaths(
    newScreen.name,
    newScreen.parent
  );

  const renamedPaths = [];

  if (await fs.pathExists(oldFeaturePath)) {
    if (oldFeaturePath !== newFeaturePath)
      await fs.move(oldFeaturePath, newFeaturePath);
    console.log(
      `Handled feature dir rename/move: ${oldFeaturePath} -> ${newFeaturePath}`
    );
    renamedPaths.push(newFeaturePath);
  }
  if (oldExpoScreenDir && (await fs.pathExists(oldExpoScreenDir))) {
    if (oldExpoScreenDir !== newExpoScreenDir) {
      await fs.ensureDir(path.dirname(newExpoScreenDir));
      await fs.move(oldExpoScreenDir, newExpoScreenDir);
    }
    console.log(
      `Handled Expo screen directory rename/move: ${oldExpoScreenDir} -> ${newExpoScreenDir}`
    );
    renamedPaths.push(newExpoScreenDir);
  }
  if (oldWebDir && (await fs.pathExists(oldWebDir))) {
    if (oldWebDir !== newWebDir) {
      await fs.ensureDir(path.dirname(newWebDir));
      await fs.move(oldWebDir, newWebDir);
    }
    console.log(`Handled Web dir rename/move: ${oldWebDir} -> ${newWebDir}`);
    renamedPaths.push(newWebDir);
  }
  return renamedPaths;
}

async function modifyLayoutFileWithAst(actions) {
  const fileContent = await fs.readFile(NAVIGATION_CONFIG_PATH, "utf-8");
  const sourceFile = ts.createSourceFile(
    path.basename(NAVIGATION_CONFIG_PATH),
    fileContent,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX
  );

  const transformResult = ts.transform(sourceFile, [
    (context) => {
      const { factory } = context;
      const visit = (node) => {
        if (ts.isObjectLiteralExpression(node)) {
          const namePropNode = node.properties.find(
            (p) => p.name?.getText(sourceFile) === "name"
          );
          if (
            namePropNode &&
            ts.isPropertyAssignment(namePropNode) &&
            ts.isStringLiteral(namePropNode.initializer)
          ) {
            const navigatorName = namePropNode.initializer.text;
            const screensToAddForThisNav =
              actions.screensToAdd?.filter(
                (s) => s.parentName === navigatorName
              ) || [];
            const screenNamesToDeleteFromThisNav = new Set(
              (
                actions.screenNamesToDelete?.filter(
                  (s) => s.parentName === navigatorName
                ) || []
              ).map((s) => s.name)
            );

            if (
              screensToAddForThisNav.length > 0 ||
              screenNamesToDeleteFromThisNav.size > 0
            ) {
              const screensPropNode = node.properties.find(
                (p) => p.name?.getText(sourceFile) === "screens"
              );
              if (
                screensPropNode &&
                ts.isPropertyAssignment(screensPropNode) &&
                ts.isArrayLiteralExpression(screensPropNode.initializer)
              ) {
                let currentScreenElements = [
                  ...screensPropNode.initializer.elements,
                ];
                if (screenNamesToDeleteFromThisNav.size > 0) {
                  currentScreenElements = currentScreenElements.filter(
                    (elNode) => {
                      if (ts.isObjectLiteralExpression(elNode)) {
                        const screenNameProp = elNode.properties.find(
                          (p) => p.name?.getText(sourceFile) === "name"
                        );
                        if (
                          screenNameProp &&
                          ts.isPropertyAssignment(screenNameProp) &&
                          ts.isStringLiteral(screenNameProp.initializer)
                        ) {
                          return !screenNamesToDeleteFromThisNav.has(
                            screenNameProp.initializer.text
                          );
                        }
                      }
                      return true;
                    }
                  );
                }
                if (screensToAddForThisNav.length > 0) {
                  screensToAddForThisNav.forEach((screenDetail) => {
                    const typePropNode = node.properties.find(
                      (p) => p.name?.getText(sourceFile) === "type"
                    );
                    if (
                      typePropNode &&
                      ts.isPropertyAssignment(typePropNode) &&
                      ts.isStringLiteral(typePropNode.initializer)
                    ) {
                      screenDetail.parentType = typePropNode.initializer.text;
                    }
                    currentScreenElements.push(
                      createScreenAstNode(factory, screenDetail)
                    );
                  });
                }
                const newScreensArray = factory.updateArrayLiteralExpression(
                  screensPropNode.initializer,
                  currentScreenElements
                );
                return factory.updateObjectLiteralExpression(
                  node,
                  node.properties.map((p) =>
                    p === screensPropNode
                      ? factory.updatePropertyAssignment(
                          screensPropNode,
                          screensPropNode.name,
                          newScreensArray
                        )
                      : p
                  )
                );
              }
            }
          }
        }
        if (
          actions.clearCommands &&
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "commandsToExecute"
        ) {
          return factory.updateVariableDeclaration(
            node,
            node.name,
            node.exclamationToken,
            node.type,
            factory.createObjectLiteralExpression(
              [
                factory.createPropertyAssignment(
                  "add",
                  factory.createArrayLiteralExpression([], true)
                ),
                factory.createPropertyAssignment(
                  "delete",
                  factory.createArrayLiteralExpression([], true)
                ),
              ],
              true
            )
          );
        }
        return ts.visitEachChild(node, visit, context);
      };

      return (sf) => {
        let statements = [...sf.statements];
        let existingImports = statements.filter(ts.isImportDeclaration);
        const otherStatements = statements.filter(
          (s) => !ts.isImportDeclaration(s)
        );
        let importsChanged = false;

        if (actions.importsToRemove?.length > 0) {
          const componentsToRemove = new Set(
            actions.importsToRemove
              .map((imp) => imp.componentName)
              .filter(Boolean)
          );
          if (componentsToRemove.size > 0) {
            const newImportsList = [];
            let localImportsChanged = false;
            existingImports.forEach((importDecl) => {
              if (
                importDecl.importClause?.namedBindings &&
                ts.isNamedImports(importDecl.importClause.namedBindings)
              ) {
                const originalElements =
                  importDecl.importClause.namedBindings.elements;
                const newElements = originalElements.filter(
                  (el) => !componentsToRemove.has(el.name.text)
                );
                if (newElements.length < originalElements.length) {
                  localImportsChanged = true;
                  if (newElements.length > 0) {
                    const updatedBinding = factory.updateNamedImports(
                      importDecl.importClause.namedBindings,
                      newElements
                    );
                    const updatedClause = factory.updateImportClause(
                      importDecl.importClause,
                      importDecl.importClause.isTypeOnly,
                      importDecl.importClause.name,
                      updatedBinding
                    );
                    newImportsList.push(
                      factory.updateImportDeclaration(
                        importDecl,
                        importDecl.modifiers,
                        importDecl.modifiers,
                        updatedClause,
                        importDecl.moduleSpecifier,
                        importDecl.assertClause
                      )
                    );
                  }
                } else newImportsList.push(importDecl);
              } else newImportsList.push(importDecl);
            });
            if (localImportsChanged) {
              existingImports = newImportsList;
              importsChanged = true;
            }
          }
        }

        if (actions.importsToAdd?.length > 0) {
          actions.importsToAdd.forEach((imp) => {
            if (
              !imp.componentName ||
              !imp.screenName ||
              !/^[a-zA-Z_$][a-zA-Z\d_$]*$/.test(imp.componentName)
            ) {
              console.warn(
                `AST: Invalid import details: ${JSON.stringify(imp)}`
              );
              return;
            }
            const relativePath = `#features/${imp.screenName}/screen`;
            const alreadyExists = existingImports.some(
              (i) =>
                i.importClause?.namedBindings &&
                ts.isNamedImports(i.importClause.namedBindings) &&
                i.importClause.namedBindings.elements.some(
                  (el) => el.name.text === imp.componentName
                ) &&
                ts.isStringLiteral(i.moduleSpecifier) &&
                i.moduleSpecifier.text === relativePath
            );
            if (!alreadyExists) {
              const newImportSpecifier = factory.createImportSpecifier(
                false,
                undefined,
                factory.createIdentifier(imp.componentName)
              );
              const newNamedImports = factory.createNamedImports([
                newImportSpecifier,
              ]);
              const newImportClause = factory.createImportClause(
                false,
                undefined,
                newNamedImports
              );
              existingImports.push(
                factory.createImportDeclaration(
                  undefined,
                  undefined,
                  newImportClause,
                  factory.createStringLiteral(relativePath),
                  undefined
                )
              );
              importsChanged = true;
            }
          });
        }

        const transformedOtherStatements = ts.visitNodes(
          factory.createNodeArray(otherStatements),
          visit,
          context
        );

        if (importsChanged) {
          return factory.updateSourceFile(sf, [
            ...existingImports,
            ...transformedOtherStatements,
          ]);
        }
        const bodyTransformed = ts.visitNodes(
          factory.createNodeArray(otherStatements),
          visit,
          context
        );
        return factory.updateSourceFile(sf, [
          ...existingImports,
          ...bodyTransformed,
        ]);
      };
    },
  ]);

  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const newFileContent = printer.printFile(transformResult.transformed[0]);

  ignoreNextConfigChange = true;
  await fs.writeFile(NAVIGATION_CONFIG_PATH, newFileContent);
  console.log(`layout.tsx AST updated programmatically.`);
}

async function processBatchOfChanges(currentScreensFromParse) {
  if (actionInProgress) {
    console.warn(
      "processBatchOfChanges called while actionInProgress was already true. This is unexpected."
    );
    reevaluateAfterCompletion = true;
    return false;
  }
  actionInProgress = true;
  let astModifiedInThisBatch = false;

  try {
    const { newScreens, deletedScreens, updatedScreens, renamedScreens } =
      identifyChanges(
        currentScreensFromParse,
        lastAcknowledgedConfigState?.screens
      );

    const hasAnyChanges =
      newScreens.length > 0 ||
      deletedScreens.length > 0 ||
      updatedScreens.length > 0 ||
      renamedScreens.length > 0;

    if (!hasAnyChanges) {
      console.log(
        "No actionable screen changes to process relative to last acknowledged state."
      );
      lastAcknowledgedConfigState = { screens: currentScreensFromParse };
      actionInProgress = false;
      return false;
    }

    let promptMessage =
      "The following changes are detected based on your latest edits:\n";
    if (deletedScreens.length > 0)
      promptMessage += `  - DELETIONS: ${deletedScreens.map((s) => `${s.name} (from ${s.parent.name})`).join(", ")}\n`;
    if (renamedScreens.length > 0)
      promptMessage += `  - RENAMES: ${renamedScreens.map((r) => `'${r.oldScreen.name}' (in ${r.oldScreen.parent.name}) to '${r.newScreen.name}' (in ${r.newScreen.parent.name})`).join(", ")}\n`;
    if (updatedScreens.length > 0)
      promptMessage += `  - UPDATES: ${updatedScreens.map((u) => `${u.newScreen.name} (in ${u.newScreen.parent.name})`).join(", ")}\n`;
    if (newScreens.length > 0)
      promptMessage += `  - ADDITIONS: ${newScreens.map((s) => `${s.name} (in ${s.parent.name})`).join(", ")}\n`;
    promptMessage += "Do you want to proceed with these changes now?";

    const { confirmProcessNow } = await inquirer.default.prompt([
      {
        type: "confirm",
        name: "confirmProcessNow",
        message: promptMessage,
        default: true,
      },
    ]);

    if (!confirmProcessNow) {
      console.log("User chose not to process accumulated changes now.");
      actionInProgress = false;
      return false;
    }

    let changesEffectivelyMade = false;
    const allGeneratedOrModifiedFiles = new Set();
    const astModificationsBatch = {
      screensToAdd: [],
      screenNamesToDelete: [],
      importsToAdd: [],
      importsToRemove: [],
    };

    for (const screen of deletedScreens) {
      console.log(
        `\nProcessing DELETION for screen: ${screen.name} in ${screen.parent.name}`
      );
      const deletedFilePaths = await deleteScreenFiles(
        screen.name,
        screen.parent
      );
      deletedFilePaths.forEach((p) => allGeneratedOrModifiedFiles.add(p));
      astModificationsBatch.screenNamesToDelete.push({
        name: screen.name,
        parentName: screen.parent.name,
      });
      if (screen.componentName)
        astModificationsBatch.importsToRemove.push({
          componentName: screen.componentName,
        });
      changesEffectivelyMade = true;
    }

    for (const { oldScreen, newScreen } of renamedScreens) {
      console.log(
        `\nProcessing RENAME for '${oldScreen.name}' to '${newScreen.name}' (parent: ${oldScreen.parent.name} -> ${newScreen.parent.name})`
      );
      const renamedFilePaths = await renameScreenFiles(oldScreen, newScreen);
      renamedFilePaths.forEach((p) => allGeneratedOrModifiedFiles.add(p));

      const featureP = await generateFeatureScreen(
        newScreen.name,
        newScreen.componentName,
        newScreen.title || newScreen.name,
        true,
        true
      );
      if (featureP) allGeneratedOrModifiedFiles.add(featureP);
      const expoP = await generateExpoFile(
        newScreen.name,
        newScreen.componentName,
        newScreen.parent,
        true,
        true
      );
      if (expoP) allGeneratedOrModifiedFiles.add(expoP);
      const webP = await generateWebFile(
        newScreen.name,
        newScreen.componentName,
        newScreen.parent,
        true,
        true
      );
      if (webP) allGeneratedOrModifiedFiles.add(webP);

      astModificationsBatch.screenNamesToDelete.push({
        name: oldScreen.name,
        parentName: oldScreen.parent.name,
      });
      if (oldScreen.componentName)
        astModificationsBatch.importsToRemove.push({
          componentName: oldScreen.componentName,
        });

      astModificationsBatch.screensToAdd.push({
        ...newScreen,
        parentName: newScreen.parent.name,
        parentType: newScreen.parent.type,
      });
      astModificationsBatch.importsToAdd.push({
        componentName: newScreen.componentName,
        screenName: newScreen.name,
      });
      changesEffectivelyMade = true;
    }

    for (const { oldScreen, newScreen } of updatedScreens) {
      console.log(
        `\nProcessing UPDATE for screen: ${newScreen.name} in ${newScreen.parent.name}`
      );
      if (
        oldScreen.parent.name !== newScreen.parent.name ||
        oldScreen.name !== newScreen.name
      ) {
        const renamedFilePaths = await renameScreenFiles(oldScreen, newScreen);
        renamedFilePaths.forEach((p) => allGeneratedOrModifiedFiles.add(p));
      }
      const featureP = await generateFeatureScreen(
        newScreen.name,
        newScreen.componentName,
        newScreen.title || newScreen.name,
        true,
        true
      );
      if (featureP) allGeneratedOrModifiedFiles.add(featureP);
      const expoP = await generateExpoFile(
        newScreen.name,
        newScreen.componentName,
        newScreen.parent,
        true,
        true
      );
      if (expoP) allGeneratedOrModifiedFiles.add(expoP);
      const webP = await generateWebFile(
        newScreen.name,
        newScreen.componentName,
        newScreen.parent,
        true,
        true
      );
      if (webP) allGeneratedOrModifiedFiles.add(webP);

      astModificationsBatch.screenNamesToDelete.push({
        name: oldScreen.name,
        parentName: oldScreen.parent.name,
      });
      if (
        oldScreen.componentName &&
        oldScreen.componentName !== newScreen.componentName
      ) {
        astModificationsBatch.importsToRemove.push({
          componentName: oldScreen.componentName,
        });
      }

      astModificationsBatch.screensToAdd.push({
        ...newScreen,
        parentName: newScreen.parent.name,
        parentType: newScreen.parent.type,
      });
      if (
        !astModificationsBatch.importsToAdd.find(
          (i) =>
            i.componentName === newScreen.componentName &&
            i.screenName === newScreen.name
        )
      ) {
        astModificationsBatch.importsToAdd.push({
          componentName: newScreen.componentName,
          screenName: newScreen.name,
        });
      }
      changesEffectivelyMade = true;
    }

    for (const screen of newScreens) {
      console.log(
        `\nProcessing ADDITION for screen: ${screen.name} in ${screen.parent.name}`
      );
      const featureP = await generateFeatureScreen(
        screen.name,
        screen.componentName,
        screen.title || screen.name,
        false,
        true
      );
      if (featureP) allGeneratedOrModifiedFiles.add(featureP);
      const expoP = await generateExpoFile(
        screen.name,
        screen.componentName,
        screen.parent,
        false,
        true
      );
      if (expoP) allGeneratedOrModifiedFiles.add(expoP);
      const webP = await generateWebFile(
        screen.name,
        screen.componentName,
        screen.parent,
        false,
        true
      );
      if (webP) allGeneratedOrModifiedFiles.add(webP);

      astModificationsBatch.screensToAdd.push({
        ...screen,
        parentName: screen.parent.name,
        parentType: screen.parent.type,
      });
      astModificationsBatch.importsToAdd.push({
        componentName: screen.componentName,
        screenName: screen.name,
      });
      changesEffectivelyMade = true;
    }

    if (changesEffectivelyMade) {
      await modifyLayoutFileWithAst(astModificationsBatch);
      astModifiedInThisBatch = true;
    }

    if (changesEffectivelyMade || ignoreNextConfigChange) {
      const finalLayoutState = await parseNavigationConfig(
        NAVIGATION_CONFIG_PATH
      );
      if (finalLayoutState?.screens) {
        lastAcknowledgedConfigState = { screens: finalLayoutState.screens };
      } else {
        lastAcknowledgedConfigState = { screens: currentScreensFromParse };
      }
      console.log("Snapshot `lastAcknowledgedConfigState` updated.");

      const filesToCommit = [
        NAVIGATION_CONFIG_PATH,
        ...allGeneratedOrModifiedFiles,
      ];
      const uniqueFiles = [...new Set(filesToCommit.filter(Boolean))];

      if (uniqueFiles.length > 0) {
        const { confirmCommit } = await inquirer.default.prompt([
          {
            type: "confirm",
            name: "confirmCommit",
            message: `Git Commit ${uniqueFiles.length} changes?`,
            default: true,
          },
        ]);
        if (confirmCommit) {
          await commitChanges(
            `sync: navigation structure & files`,
            uniqueFiles
          );
        }
      }
    }
  } catch (error) {
    console.error("An error occurred during processBatchOfChanges:", error);
  } finally {
    actionInProgress = false;
    if (reevaluateAfterCompletion) {
      reevaluateAfterCompletion = false;
      setImmediate(() => onConfigFileChanged(NAVIGATION_CONFIG_PATH));
    }
  }
  return astModifiedInThisBatch;
}

// --- Project Consistency Validation (Updated for Expo folder structure) ---
// function getLayoutImports(sourceFile) { // This function is defined below validateProjectConsistency in your original script
//   const imports = [];
//   if (!sourceFile) return imports;
//   sourceFile.statements.forEach(statement => {
//     if (ts.isImportDeclaration(statement)) {
//       const moduleSpecifier = statement.moduleSpecifier;
//       if (ts.isStringLiteral(moduleSpecifier)) {
//         const importPath = moduleSpecifier.text;
//         const match = importPath.match(/^#features\/([a-zA-Z0-9_.-]+)\/screen$/);
//         if (match) {
//           const screenName = match[1];
//           if (statement.importClause && statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
//             statement.importClause.namedBindings.elements.forEach(element => {
//               imports.push({ componentName: element.name.text, screenName: screenName });
//             });
//           }
//         }
//       }
//     }
//   });
//   return imports;
// }

async function getExistingScreenDirectories() {
  const screens = { features: new Set(), expo: new Map(), web: new Map() };

  // Scan for feature directories (This part is correct)
  if (await fs.pathExists(FEATURES_PATH)) {
    const featureItems = await fs.readdir(FEATURES_PATH);
    for (const item of featureItems) {
      if (
        (await fs.stat(path.join(FEATURES_PATH, item))).isDirectory() &&
        (await fs.pathExists(path.join(FEATURES_PATH, item, "screen.tsx")))
      ) {
        screens.features.add(item);
      }
    }
  }

  // --- REWRITTEN Expo/Web File Scanner ---
  const scanAppDirRecursive = async (
    currentDir,
    platformMap,
    parentPathSegments = []
  ) => {
    if (!(await fs.pathExists(currentDir))) return;
    const items = await fs.readdir(currentDir, { withFileTypes: true });
    const currentParentKey =
      parentPathSegments.length > 0
        ? parentPathSegments[parentPathSegments.length - 1]
        : path.basename(currentDir);

    for (const item of items) {
      const itemName = item.name;
      const itemPath = path.join(currentDir, itemName);

      // Ignore layout files and dotfiles
      if (itemName.startsWith("_") || itemName.startsWith(".")) {
        continue;
      }

      // We only care about directories, since all routes are dir/index.tsx
      if (item.isDirectory()) {
        const indexFile =
          platformMap === screens.expo ? "index.tsx" : "page.tsx";
        if (await fs.pathExists(path.join(itemPath, indexFile))) {
          // KEY CHANGE: The route name is the directory name itself.
          // This matches the `name` field in your layout.tsx.
          // e.g., for directory 'account', the routeName is 'account'.
          const routeName = itemName;
          if (!platformMap.has(currentParentKey))
            platformMap.set(currentParentKey, new Set());
          platformMap.get(currentParentKey).add(routeName);
        }

        // Always recurse into layout groups like (tabs) to find nested screens.
        if (itemName.startsWith("(") && itemName.endsWith(")")) {
          await scanAppDirRecursive(itemPath, platformMap, [
            ...parentPathSegments,
            itemName,
          ]);
        }
      }
    }
  };

  // Execute the scan for Expo and Web
  const expoLayoutRoots = (
    (await fs.pathExists(EXPO_APP_PATH))
      ? await fs.readdir(EXPO_APP_PATH, { withFileTypes: true })
      : []
  )
    .filter(
      (d) => d.isDirectory() && d.name.startsWith("(") && d.name.endsWith(")")
    )
    .map((d) => d.name);
  for (const root of expoLayoutRoots)
    await scanAppDirRecursive(path.join(EXPO_APP_PATH, root), screens.expo, [
      root,
    ]);

  const webLayoutRoots = (
    (await fs.pathExists(WEB_APP_PATH))
      ? await fs.readdir(WEB_APP_PATH, { withFileTypes: true })
      : []
  )
    .filter(
      (d) => d.isDirectory() && d.name.startsWith("(") && d.name.endsWith(")")
    )
    .map((d) => d.name);
  for (const root of webLayoutRoots)
    await scanAppDirRecursive(path.join(WEB_APP_PATH, root), screens.web, [
      root,
    ]);

  return screens;
}

// This function was defined after validateProjectConsistency in your original script.
// For clarity and to avoid potential hoisting issues if not using function declarations strictly,
// it's often better to define functions before they are called.
// However, JavaScript function declarations are hoisted.
function getLayoutImports(sourceFile) {
  const imports = [];
  if (!sourceFile) return imports;

  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const importPath = moduleSpecifier.text;

        // CORRECTED REGEX: The hyphen '-' is moved to the end of the character class
        // to be treated as a literal character, not a range specifier.
        const match = importPath.match(
          /features\/([a-zA-Z0-9_().-]+)\/screen$/
        );

        if (match) {
          // match[1] will correctly capture '(home)' from a path like '.../features/(home)/screen'
          const screenName = match[1];
          if (
            statement.importClause &&
            statement.importClause.namedBindings &&
            ts.isNamedImports(statement.importClause.namedBindings)
          ) {
            statement.importClause.namedBindings.elements.forEach((element) => {
              imports.push({
                componentName: element.name.text,
                screenName: screenName,
              });
            });
          }
        }
      }
    }
  });

  return imports;
}

async function validateProjectConsistency(
  declaredScreens,
  layoutSourceFile,
  isInteractive = true
) {
  console.log("🕵️ Running project consistency validation...");
  let fixesAppliedThisRun = false;
  let astModifiedThisRun = false;
  const proposedFixes = [];
  const layoutRelativePath = path.relative(
    MONOREPO_ROOT,
    NAVIGATION_CONFIG_PATH
  );

  if (!declaredScreens || !layoutSourceFile) {
    console.error(
      "Validation error: Missing declaredScreens or layoutSourceFile for validation."
    );
    return { fixesApplied: false, astModified: false };
  }

  const {
    features: actualFeatureScreens,
    expo: actualExpoScreensByParent,
    web: actualWebScreensByParent,
  } = await getExistingScreenDirectories();
  const actualImports = getLayoutImports(layoutSourceFile) || []; // Removed await, getLayoutImports is synchronous

  for (const screen of declaredScreens) {
    if (
      !screen.name ||
      !screen.componentName ||
      !screen.parent ||
      !screen.parent.name
    ) {
      console.warn(
        `Validator: Skipping screen with incomplete data: ${JSON.stringify(screen)}`
      );
      continue;
    }
    if (!actualFeatureScreens.has(screen.name)) {
      proposedFixes.push({
        description: `Screen '${screen.name}': Missing feature directory.`,
        action: () =>
          generateFeatureScreen(
            screen.name,
            screen.componentName,
            screen.title
          ),
        type: "file",
        fixType: "generate_feature",
      });
    }

    const expoParentScreens = actualExpoScreensByParent.get(screen.parent.name);
    if (!expoParentScreens || !expoParentScreens.has(screen.name)) {
      proposedFixes.push({
        description: `Screen '${screen.name}' in Expo parent '${screen.parent.name}': Missing Expo screen directory/index.tsx.`,
        action: () =>
          generateExpoFile(screen.name, screen.componentName, screen.parent),
        type: "file",
        fixType: "generate_expo",
      });
    }

    const webParentScreens = actualWebScreensByParent.get(screen.parent.name);
    if (!webParentScreens || !webParentScreens.has(screen.name)) {
      proposedFixes.push({
        description: `Screen '${screen.name}' in Web parent '${screen.parent.name}': Missing Web page directory/page.tsx.`,
        action: () =>
          generateWebFile(screen.name, screen.componentName, screen.parent),
        type: "file",
        fixType: "generate_web",
      });
    }

    const hasCorrectImport = actualImports.some(
      (imp) =>
        imp.componentName === screen.componentName &&
        imp.screenName === screen.name
    );
    if (!hasCorrectImport) {
      proposedFixes.push({
        description: `Screen '${screen.name}': Missing import for '${screen.componentName}'.`,
        type: "ast",
        fixType: "add_import",
        screenData: {
          componentName: screen.componentName,
          screenName: screen.name,
        },
      });
    }
  }

  actualFeatureScreens.forEach((name) => {
    if (!declaredScreens.some((s) => s.name === name)) {
      proposedFixes.push({
        description: `Orphaned feature: '${name}'.`,
        action: () =>
          deleteScreenFiles(name, { name: "unknown", type: "unknown" }),
        type: "file",
        fixType: "delete_feature",
      });
    }
  });

  actualExpoScreensByParent.forEach((screenSet, parentName) => {
    screenSet.forEach((screenName) => {
      if (
        !declaredScreens.some(
          (s) => s.name === screenName && s.parent.name === parentName
        )
      ) {
        proposedFixes.push({
          description: `Orphaned Expo screen directory: '${screenName}' in '${parentName}'.`,
          action: () =>
            deleteScreenFiles(screenName, {
              name: parentName,
              type: "unknown_expo_parent",
            }),
          type: "file",
          fixType: "delete_expo",
        });
      }
    });
  });
  actualWebScreensByParent.forEach((screenSet, parentName) => {
    screenSet.forEach((screenName) => {
      if (
        !declaredScreens.some(
          (s) => s.name === screenName && s.parent.name === parentName
        )
      ) {
        proposedFixes.push({
          description: `Orphaned Web page directory: '${screenName}' in '${parentName}'.`,
          action: () =>
            deleteScreenFiles(screenName, {
              name: parentName,
              type: "unknown_web_parent",
            }),
          type: "file",
          fixType: "delete_web",
        });
      }
    });
  });

  actualImports.forEach((imp) => {
    if (
      !declaredScreens.some(
        (s) =>
          s.componentName === imp.componentName && s.name === imp.screenName
      )
    ) {
      proposedFixes.push({
        description: `Orphaned import: '${imp.componentName}' from '#features/${imp.screenName}/screen'.`,
        type: "ast",
        fixType: "remove_import",
        screenData: { componentName: imp.componentName },
      });
    }
  });

  if (proposedFixes.length === 0) {
    console.log("✅ Project consistency validation passed.");
    return { fixesApplied: false, astModified: false };
  }

  console.warn("\nProject Consistency Discrepancies Found:");
  const choices = proposedFixes.map((fix, index) => ({
    name: `${fix.description} (Action: ${fix.fixType.replace(/_/g, " ")})`,
    value: index,
    checked: true,
  }));

  if (!isInteractive) {
    console.log("Non-interactive mode. Skipping automatic fixes.");
    return { fixesApplied: false, astModified: false };
  }

  const { selectedFixIndices } = await inquirer.default.prompt([
    {
      type: "checkbox",
      name: "selectedFixIndices",
      message: "Select fixes to apply:",
      choices: choices,
      pageSize: Math.min(choices.length, 20),
    },
  ]);

  if (!selectedFixIndices || selectedFixIndices.length === 0) {
    console.log("No fixes selected by user.");
    return { fixesApplied: false, astModified: false };
  }

  const astActionsForBatch = {
    importsToAdd: [],
    importsToRemove: [],
    screensToAdd: [],
    screenNamesToDelete: [],
    clearCommands: false,
  };

  for (const index of selectedFixIndices) {
    const fix = proposedFixes[index];
    console.log(`Applying: ${fix.description}`);
    if (fix.type === "file" && fix.action) {
      try {
        await fix.action();
        fixesAppliedThisRun = true;
      } catch (e) {
        console.error(`Error applying file fix: ${fix.description}`, e);
      }
    } else if (fix.type === "ast") {
      if (fix.fixType === "add_import" && fix.screenData)
        astActionsForBatch.importsToAdd.push(fix.screenData);
      else if (fix.fixType === "remove_import" && fix.screenData)
        astActionsForBatch.importsToRemove.push(fix.screenData);
    }
  }

  if (
    astActionsForBatch.importsToAdd.length > 0 ||
    astActionsForBatch.importsToRemove.length > 0
  ) {
    console.log("Applying batched AST modifications for imports...");
    try {
      await modifyLayoutFileWithAst(astActionsForBatch);
      astModifiedThisRun = true;
      fixesAppliedThisRun = true;
    } catch (e) {
      console.error("Error applying AST fixes:", e);
    }
  }

  if (fixesAppliedThisRun) console.log("Consistency fixes applied.");
  else console.log("No fixes were applied.");
  return { fixesApplied: fixesAppliedThisRun, astModified: astModifiedThisRun };
}

// --- onConfigFileChanged (Original logic flow, uses updated parser) ---
async function onConfigFileChanged(changedPath) {
  if (actionInProgress) {
    console.log(
      "An operation batch is already in progress. Queuing re-evaluation..."
    );
    reevaluateAfterCompletion = true;
    return;
  }

  if (changedPath === NAVIGATION_CONFIG_PATH && ignoreNextConfigChange) {
    console.log("Ignoring this config change as it was programmatic.");
    ignoreNextConfigChange = false;
    try {
      const updatedConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (updatedConfig && updatedConfig.screens) {
        lastAcknowledgedConfigState = { screens: updatedConfig.screens };
        console.log(
          "Refreshed lastAcknowledgedConfigState after programmatic change."
        );
      }
    } catch (e) {
      console.error("Error refreshing lastAcknowledgedConfigState:", e);
    }
    return;
  }

  console.log(`Change detected in ${NAVIGATION_CONFIG_PATH}. Parsing...`);
  let parsedResult = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);

  if (!parsedResult) {
    console.warn(
      "Could not parse navigation config. Waiting for next valid change."
    );
    editingModeActive = false;
    return;
  }

  let currentScreensFromFile = parsedResult.screens;
  let astModifiedByCommands = false;

  const { isAutoSaveOn, isEditing, commandsToExecute } = parsedResult;
  console.log(
    `Parsed flags from file: isAutoSaveOn=${isAutoSaveOn}, isEditing=${isEditing}`
  );
  const hasPendingCliCommands =
    commandsToExecute &&
    (commandsToExecute.add?.length > 0 || commandsToExecute.delete?.length > 0);

  if (isAutoSaveOn) {
    if (isEditing && !hasPendingCliCommands) {
      if (!editingModeActive) {
        console.log(
          "Autosave ON, `isEditing` true (no commands). Entering editing mode."
        );
        editingModeActive = true;
      } else {
        console.log(
          "Still in editing mode (Autosave ON, `isEditing` true, no commands)."
        );
      }
      return;
    } else {
      if (editingModeActive && !isEditing) {
        console.log("`isEditing` is now false. Processing changes.");
        editingModeActive = false;
      } else if (!editingModeActive && !isEditing && isAutoSaveOn) {
        console.log("Autosave ON, `isEditing` false. Processing changes.");
      }
    }
  } else {
    if (editingModeActive) {
      console.log("Autosave OFF. Exiting editing mode and processing changes.");
      editingModeActive = false;
    }
  }

  if (hasPendingCliCommands) {
    console.log("Applying commands from `commandsToExecute` in layout.tsx...");

    const actionsForAst = {
      screensToAdd: [],
      screenNamesToDelete: [],
      importsToAdd: [],
      importsToRemove: [],
      clearCommands: true,
    };

    for (const cmd of commandsToExecute.add || []) {
      const { parentName } = await inquirer.default.prompt([
        {
          type: "list",
          name: "parentName",
          message: `Command: Add '${cmd.name}'. Which parent navigator?`,
          choices: [
            { name: "(drawer)", value: "(drawer)" },
            { name: "(tabs)", value: "(tabs)" },
          ],
        },
      ]);
      const parentType = parentName === "(tabs)" ? "tabs" : "drawer";
      const componentName =
        cmd.componentName || capitalizeFirstLetter(cmd.name) + "Screen";
      actionsForAst.screensToAdd.push({
        name: cmd.name,
        componentName,
        title: cmd.title,
        icon: cmd.icon,
        label: cmd.label,
        href: cmd.href,
        parentName,
        parentType,
      });
      actionsForAst.importsToAdd.push({ componentName, screenName: cmd.name });
    }
    for (const cmd of commandsToExecute.delete || []) {
      const { parentName } = await inquirer.default.prompt([
        {
          type: "list",
          name: "parentName",
          message: `Command: Delete '${cmd.name}'. Which parent navigator?`,
          choices: [
            { name: "(drawer)", value: "(drawer)" },
            { name: "(tabs)", value: "(tabs)" },
          ],
        },
      ]);
      const screenInLayout = currentScreensFromFile.find(
        (s) => s.name === cmd.name && s.parent.name === parentName
      );
      const componentName =
        cmd.componentName ||
        (screenInLayout ? screenInLayout.componentName : null);
      actionsForAst.screenNamesToDelete.push({
        name: cmd.name,
        parentName: parentName,
      });
      if (componentName) actionsForAst.importsToRemove.push({ componentName });
    }

    if (
      actionsForAst.screensToAdd.length > 0 ||
      actionsForAst.screenNamesToDelete.length > 0 ||
      actionsForAst.importsToAdd.length > 0 ||
      actionsForAst.importsToRemove.length > 0
    ) {
      await modifyLayoutFileWithAst(actionsForAst);
      astModifiedByCommands = true;
      const newParsedResult = await parseNavigationConfig(
        NAVIGATION_CONFIG_PATH
      );
      if (newParsedResult) {
        parsedResult = newParsedResult;
        currentScreensFromFile = newParsedResult.screens;
      } else {
        console.error(
          "Failed to re-parse layout.tsx after applying commands. Aborting further processing."
        );
        return;
      }
      lastAcknowledgedConfigState = { screens: currentScreensFromFile };
      console.log(
        "Applied commands from layout.tsx and updated internal state."
      );
    } else if (
      actionsForAst.clearCommands &&
      (commandsToExecute.add?.length > 0 ||
        commandsToExecute.delete?.length > 0)
    ) {
      console.log(
        "Clearing empty or ineffective commandsToExecute from layout.tsx."
      );
      await modifyLayoutFileWithAst({ clearCommands: true });
      astModifiedByCommands = true;
      const newParsedResult = await parseNavigationConfig(
        NAVIGATION_CONFIG_PATH
      );
      if (newParsedResult) {
        parsedResult = newParsedResult;
        currentScreensFromFile = newParsedResult.screens;
        lastAcknowledgedConfigState = { screens: currentScreensFromFile };
      }
    } else {
      console.log(
        "No effective AST changes from commandsToExecute. Only clearing the commands array."
      );
      await modifyLayoutFileWithAst({ clearCommands: true });
      astModifiedByCommands = true;
    }
  }

  const astModifiedByBatch = await processBatchOfChanges(
    currentScreensFromFile
  );
  const astModifiedThisCycle = astModifiedByCommands || astModifiedByBatch;

  console.log("Running post-change consistency validation...");
  let configForValidation = parsedResult;
  if (astModifiedThisCycle) {
    const freshConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (freshConfig) configForValidation = freshConfig;
    else
      console.warn(
        "Could not re-parse for validation after potential AST modifications in the cycle."
      );
  }

  if (
    configForValidation &&
    configForValidation.screens &&
    configForValidation.sourceFile
  ) {
    const validationResult = await validateProjectConsistency(
      configForValidation.screens,
      configForValidation.sourceFile
    );
    if (validationResult.astModified || validationResult.fixesApplied) {
      const finalConfigAfterValidation = await parseNavigationConfig(
        NAVIGATION_CONFIG_PATH
      );
      if (finalConfigAfterValidation?.screens) {
        lastAcknowledgedConfigState = {
          screens: finalConfigAfterValidation.screens,
        };
        console.log(
          "Refreshed lastAcknowledgedConfigState after validation fixes."
        );
      }
    } else {
      if (configForValidation.screens) {
        lastAcknowledgedConfigState = { screens: configForValidation.screens };
      }
    }
  } else {
    console.warn(
      "Could not obtain suitable config for post-change validation."
    );
  }
}

// --- Main Execution (Original structure, uses updated helpers) ---
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  let initialConfigResult;
  try {
    initialConfigResult = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (
      initialConfigResult &&
      initialConfigResult.screens &&
      initialConfigResult.sourceFile
    ) {
      lastAcknowledgedConfigState = { screens: initialConfigResult.screens };
      console.log("Initial navigation config parsed and stored.");
      console.log("Performing initial project consistency validation...");
      const validationResult = await validateProjectConsistency(
        initialConfigResult.screens,
        initialConfigResult.sourceFile
      );
      if (validationResult.astModified || validationResult.fixesApplied) {
        console.log(
          "Consistency fixes applied during startup. Re-parsing config..."
        );
        const updatedConfig = await parseNavigationConfig(
          NAVIGATION_CONFIG_PATH
        );
        if (updatedConfig?.screens) {
          lastAcknowledgedConfigState = { screens: updatedConfig.screens };
          initialConfigResult = updatedConfig;
        } else
          console.error(
            "Failed to re-parse config after initial validation fixes."
          );
      }
    } else {
      console.error(
        "Failed to parse initial config or sourceFile. Please check the file."
      );
      lastAcknowledgedConfigState = { screens: [] };
    }
  } catch (err) {
    console.error("Error during initial config parse:", err);
    lastAcknowledgedConfigState = { screens: [] };
  }

  if (command === "add" || command === "delete") {
    const screenName = args[1];
    if (!screenName) {
      console.error(
        `Please provide a screen name for the '${command}' command.`
      );
      process.exit(1);
    }
    await handleDirectCliCommands(command, [screenName]);

    const postCliConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (postCliConfig?.screens && postCliConfig.sourceFile) {
      console.log("Running post-CLI command consistency validation...");
      const validationResult = await validateProjectConsistency(
        postCliConfig.screens,
        postCliConfig.sourceFile
      );
      if (validationResult.astModified || validationResult.fixesApplied) {
        const finalConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
        if (finalConfig?.screens)
          lastAcknowledgedConfigState = { screens: finalConfig.screens };
      } else {
        lastAcknowledgedConfigState = { screens: postCliConfig.screens };
      }
    } else console.warn("Could not get latest config for post-CLI validation.");
  } else if (command) {
    console.log(
      `Unknown command: ${command}. Available commands: add, delete. Or run without commands for watcher mode.`
    );
    process.exit(1);
  } else {
    // Watcher Setup
    console.log(`Watching for changes in ${NAVIGATION_CONFIG_PATH}...`);
    const watcher = chokidar.watch(NAVIGATION_CONFIG_PATH, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    });

    watcher.on("change", (filePath) => onConfigFileChanged(filePath));
    watcher.on("error", (error) => console.error(`Watcher error: ${error}`));

    if (initialConfigResult) {
      console.log(
        `Initial flags for watcher: isAutoSaveOn=${initialConfigResult.isAutoSaveOn}, isEditing=${initialConfigResult.isEditing}`
      );
      const hasPendingCommands =
        initialConfigResult.commandsToExecute &&
        (initialConfigResult.commandsToExecute.add?.length > 0 ||
          initialConfigResult.commandsToExecute.delete?.length > 0);

      if (
        initialConfigResult.isAutoSaveOn &&
        initialConfigResult.isEditing &&
        !hasPendingCommands
      ) {
        editingModeActive = true;
        console.log(
          "Started in editing mode (watcher mode, no pending commands)."
        );
      } else if (hasPendingCommands) {
        console.log(
          "Pending commands detected on startup. Triggering initial processing for watcher."
        );
        onConfigFileChanged(NAVIGATION_CONFIG_PATH);
      } else {
        console.log(
          "Watcher started. Not in editing mode and no pending commands on startup."
        );
      }
    }
    console.log("CLI tool started in watcher mode. Press Ctrl+C to exit.");
  }
}

async function handleDirectCliCommands(command, screenNames) {
  console.log(
    `Executing direct CLI command: ${command} for screen(s): ${screenNames.join(", ")}`
  );

  try {
    let currentParsedConfig = await parseNavigationConfig(
      NAVIGATION_CONFIG_PATH
    );
    if (!currentParsedConfig || !currentParsedConfig.screens) {
      console.error("Could not parse layout.tsx for CLI command.");
      return;
    }

    const actions = {
      screensToAdd: [],
      screenNamesToDelete: [],
      importsToAdd: [],
      importsToRemove: [],
      clearCommands: false,
    };
    let astChangedByCli = false;

    for (const screenNameArg of screenNames) {
      const { parent } = await inquirer.default.prompt([
        {
          type: "list",
          name: "parent",
          message: `For screen '${screenNameArg}', which navigator should it be ${command === "add" ? "added to" : "deleted from"}?`,
          choices: [
            {
              name: "Drawer (e.g., settings)",
              value: { name: "(drawer)", type: "drawer" },
            },
            {
              name: "Tabs (e.g., home)",
              value: { name: "(tabs)", type: "tabs" },
            },
          ],
        },
      ]);

      const parentName = parent.name;
      const parentType = parent.type;

      let name = screenNameArg.toLowerCase().replace(/[^a-z0-9_]/gi, "");
      if (!name) {
        console.warn(`Invalid screen name "${screenNameArg}". Skipping.`);
        continue;
      }

      let componentName = capitalizeFirstLetter(name) + "Screen";
      let title = capitalizeFirstLetter(name);
      let icon = name.toLowerCase();
      let label = capitalizeFirstLetter(name);
      let href = `/${parentName === "(tabs)" ? "tabs" : parentName === "(drawer)" ? "drawer" : parentName}/${name}`;

      if (command === "add") {
        const { confirmDefault } = await inquirer.default.prompt([
          {
            type: "confirm",
            name: "confirmDefault",
            message: `Use default config for '${name}' in '${parentName}'? (Comp: ${componentName}, Title: ${title})`,
            default: true,
          },
        ]);
        if (!confirmDefault) {
          const answers = await inquirer.default.prompt([
            {
              type: "input",
              name: "name",
              message: "Screen name (path-safe):",
              default: name,
              validate: (input) =>
                /^[a-z0-9_]+$/.test(input) || "Invalid name.",
            },
            {
              type: "input",
              name: "componentName",
              message: "ComponentName (PascalCaseScreen):",
              default: componentName,
              validate: (input) =>
                /^[A-Z][a-zA-Z0-9_]*Screen$/.test(input) ||
                "Invalid component name.",
            },
            {
              type: "input",
              name: "title",
              message: "Screen title:",
              default: title,
            },
            {
              type: "input",
              name: "href",
              message: "Screen href:",
              default: href,
            },
          ]);
          name = answers.name;
          componentName = answers.componentName;
          title = answers.title;
          href = answers.href;
          if (parentType === "tabs") {
            const tabAnswers = await inquirer.default.prompt([
              {
                type: "input",
                name: "icon",
                message: "tabBarIconName:",
                default: icon,
              },
            ]);
            icon = tabAnswers.icon;
          } else {
            const drawerAnswers = await inquirer.default.prompt([
              {
                type: "input",
                name: "label",
                message: "drawerLabel:",
                default: label,
              },
            ]);
            label = drawerAnswers.label;
          }
        }
        const screenExistsInParent = currentParsedConfig.screens.some(
          (s) => s.name === name && s.parent.name === parentName
        );
        if (!screenExistsInParent) {
          actions.screensToAdd.push({
            name,
            componentName,
            title,
            icon,
            label,
            href,
            parentName,
            parentType,
          });
          actions.importsToAdd.push({ componentName, screenName: name });
          astChangedByCli = true;
        } else {
          console.log(
            `Screen '${name}' already exists in '${parentName}'. Skipping AST add.`
          );
        }
      } else if (command === "delete") {
        const screenToDelete = currentParsedConfig.screens.find(
          (s) => s.name === name && s.parent.name === parentName
        );
        if (!screenToDelete) {
          console.warn(
            `Screen '${name}' not found in '${parentName}'. Skipping AST delete.`
          );
          continue;
        }
        const { confirmDelete } = await inquirer.default.prompt([
          {
            type: "confirm",
            name: "confirmDelete",
            message: `Confirm removal of screen '${name}' from '${parentName}' in layout.tsx?`,
            default: true,
          },
        ]);
        if (!confirmDelete) {
          console.log(`Skipped AST removal of '${name}'.`);
          continue;
        }

        actions.screenNamesToDelete.push({
          name: screenToDelete.name,
          parentName: parentName,
        });
        if (screenToDelete.componentName)
          actions.importsToRemove.push({
            componentName: screenToDelete.componentName,
          });
        astChangedByCli = true;
      }
    }

    if (astChangedByCli) {
      await modifyLayoutFileWithAst(actions);
      console.log(`layout.tsx AST updated by CLI command: ${command}.`);
      currentParsedConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (!currentParsedConfig) {
        console.error(
          "Failed to re-parse config after direct CLI AST modification. File processing may be based on stale data."
        );
        return;
      }
    } else {
      console.log("No AST changes made by CLI command.");
    }

    if (currentParsedConfig && currentParsedConfig.screens) {
      await processBatchOfChanges(currentParsedConfig.screens);
    } else {
      console.error(
        "Could not parse config for file processing after CLI command."
      );
    }
  } catch (error) {
    console.error(
      `Error during 'handleDirectCliCommands' for ${command}:`,
      error
    );
  }
}

main().catch((err) => {
  console.error("Unhandled error in main execution:", err);
  process.exit(1);
});
