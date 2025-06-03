#!/usr/bin/env node

const chokidar = require('chokidar')
const fs = require('fs-extra')
const path = require('path')
const inquirer = require('inquirer')
const simpleGit = require('simple-git')
const ts = require('typescript')

// Determine MONOREPO_ROOT
const MONOREPO_ROOT = process.cwd()
console.log(`CLI operating with MONOREPO_ROOT: ${MONOREPO_ROOT}`)

const git = simpleGit({ baseDir: MONOREPO_ROOT })

const NAVIGATION_CONFIG_PATH = path.join(
  MONOREPO_ROOT,
  'packages/config/navigation/layout.tsx'
)
const FEATURES_PATH = path.join(MONOREPO_ROOT, 'packages/core/features')
const EXPO_APP_PATH = path.join(MONOREPO_ROOT, 'apps/expo/app')
const WEB_APP_PATH = path.join(MONOREPO_ROOT, 'apps/web/app')

let lastAcknowledgedConfigState = null
let actionInProgress = false
let ignoreNextConfigChange = false
let reevaluateAfterCompletion = false
let editingModeActive = false

function capitalizeFirstLetter(string) {
  if (!string) return ''
  return string.charAt(0).toUpperCase() + string.slice(1)
}

// --- Name Helper Functions ---
// Gets the base name used for directory segments and feature folders (e.g., "settings" from "settings/index", "(home)" from "(home)/index")
function getRouteSegmentName(configScreenName) {
  if (!configScreenName) return '';
  return configScreenName.replace(/\/index$/, '');
}

// Gets the name suitable for feature import paths and often for component name generation (strips parentheses)
// e.g., "settings" from "settings/index", "home" from "(home)/index"
function getCleanFeatureName(configScreenName) {
  if (!configScreenName) return '';
  return configScreenName.replace(/\/index$/, '').replace(/^\(|\)$/g, '');
}


// --- AST Helper Functions ---
function findAppNavigationStructureDeclaration(sourceFile) {
  let appNavDeclaration = null
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === 'appNavigationStructure') {
          appNavDeclaration = decl
          break
        }
      }
    }
    if (!appNavDeclaration) ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return appNavDeclaration
}

function createScreenAstNode(factory, screenDetails) {
  // screenDetails.name here is the full config name like "settings/index"
  const routeSegmentName = getRouteSegmentName(screenDetails.name);
  const cleanFeatureName = getCleanFeatureName(screenDetails.name);

  const optionsProperties = [
    factory.createPropertyAssignment(
      'title',
      factory.createStringLiteral(screenDetails.title || capitalizeFirstLetter(cleanFeatureName))
    ),
  ];

  if (screenDetails.parentType === 'tabs') {
    optionsProperties.push(
      factory.createPropertyAssignment(
        'tabBarIconName',
        factory.createStringLiteral(screenDetails.icon || cleanFeatureName.toLowerCase())
      )
    );
    if (screenDetails.label) {
        optionsProperties.push(
            factory.createPropertyAssignment('tabBarLabel', factory.createStringLiteral(screenDetails.label))
        );
    }
  } else if (screenDetails.parentType === 'drawer') {
    optionsProperties.push(
      factory.createPropertyAssignment(
        'drawerLabel',
        factory.createStringLiteral(screenDetails.label || capitalizeFirstLetter(cleanFeatureName))
      )
    );
  }

  const defaultHrefParentSegment = screenDetails.parentName === 'Root' ? '' : getRouteSegmentName(screenDetails.parentName);
  const defaultHref = `/${defaultHrefParentSegment ? defaultHrefParentSegment + '/' : ''}${routeSegmentName}`;
  const href = screenDetails.href || defaultHref;

  return factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment('type', factory.createStringLiteral('screen')),
      factory.createPropertyAssignment('name', factory.createStringLiteral(screenDetails.name)), // Use full name from config
      factory.createPropertyAssignment(
        'component',
        factory.createIdentifier(screenDetails.componentName)
      ),
      factory.createPropertyAssignment('href', factory.createStringLiteral(href)),
      factory.createPropertyAssignment('options', factory.createObjectLiteralExpression(optionsProperties, true)),
    ],
    true
  );
}
// --- End AST Helper Functions ---

async function parseNavigationConfig(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
      path.basename(filePath),
      fileContent,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TSX
    )

    let isAutoSaveOn = false
    let isEditing = false
    let commandsToExecute = { add: [], delete: [] }
    const parsedScreens = []

    function extractScreensRecursive(navigatorNode, parentInfo) {
      if (!ts.isObjectLiteralExpression(navigatorNode)) return;

      const screensProp = navigatorNode.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'screens');
      if (!screensProp || !ts.isPropertyAssignment(screensProp) || !ts.isArrayLiteralExpression(screensProp.initializer)) return;

      screensProp.initializer.elements.forEach((elementNode) => {
        if (ts.isObjectLiteralExpression(elementNode)) {
          const typeProp = elementNode.properties.find(p => p.name?.getText(sourceFile) === 'type' && ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer));
          const nameProp = elementNode.properties.find(p => p.name?.getText(sourceFile) === 'name' && ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer));

          if (!typeProp || !nameProp) return;

          const type = typeProp.initializer.text;
          const name = nameProp.initializer.text; // This is the full name like "settings/index"

          if (type === 'screen') {
            const screen = { parent: parentInfo, name }; // name is full name
            elementNode.properties.forEach((prop) => {
              if (ts.isPropertyAssignment(prop) && prop.name) {
                const propName = prop.name.getText(sourceFile);
                const propValueNode = prop.initializer;
                if (propName === 'component' && ts.isIdentifier(propValueNode)) screen.componentName = propValueNode.text;
                if (propName === 'href' && ts.isStringLiteral(propValueNode)) screen.href = propValueNode.text;
                if (propName === 'options' && ts.isObjectLiteralExpression(propValueNode)) {
                  propValueNode.properties.forEach(optProp => {
                    if (ts.isPropertyAssignment(optProp) && optProp.name) {
                      const optName = optProp.name.getText(sourceFile);
                      if (ts.isStringLiteral(optProp.initializer)) {
                        if (optName === 'title') screen.title = optProp.initializer.text;
                        if (optName === 'tabBarIconName') screen.icon = optProp.initializer.text;
                        if (optName === 'drawerLabel') screen.label = optProp.initializer.text;
                        if (optName === 'tabBarLabel') screen.label = optProp.initializer.text; // Assuming label can be for either
                      } else if (optName === 'showOn' && ts.isArrayLiteralExpression(optProp.initializer)) {
                        screen.showOn = optProp.initializer.elements
                            .filter(ts.isStringLiteral)
                            .map(str => str.text);
                      }
                    }
                  });
                }
              }
            });
            if (screen.name && screen.componentName) parsedScreens.push(screen);
          } else if (type === 'tabs' || type === 'drawer' || type === 'stack') {
            extractScreensRecursive(elementNode, { name, type }); // parent name is full name
          }
        }
      });
    }

    ts.forEachChild(sourceFile, node => {
        if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach((declaration) => {
                if (ts.isIdentifier(declaration.name)) {
                    const varName = declaration.name.text;
                    if (declaration.initializer) {
                        if (varName === 'isAutoSaveEnabled') {
                            isAutoSaveOn = declaration.initializer.kind === ts.SyntaxKind.TrueKeyword;
                        } else if (varName === 'isEditing') {
                            isEditing = declaration.initializer.kind === ts.SyntaxKind.TrueKeyword;
                        } else if (varName === 'commandsToExecute' && ts.isObjectLiteralExpression(declaration.initializer)) {
                            declaration.initializer.properties.forEach((prop) => {
                                if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                                    const commandType = prop.name.text;
                                    if ((commandType === 'add' || commandType === 'delete') && ts.isArrayLiteralExpression(prop.initializer)) {
                                        commandsToExecute[commandType] = [];
                                        prop.initializer.elements.forEach((elementNode) => {
                                            if (ts.isObjectLiteralExpression(elementNode)) {
                                                const commandArg = {};
                                                elementNode.properties.forEach((cmdProp) => {
                                                    if (ts.isPropertyAssignment(cmdProp) && ts.isIdentifier(cmdProp.name) && cmdProp.initializer) {
                                                        const cmdPropName = cmdProp.name.text;
                                                        if (ts.isStringLiteral(cmdProp.initializer) || (ts.isIdentifier(cmdProp.initializer) && typeof cmdProp.initializer.text === 'string')) {
                                                            commandArg[cmdPropName] = cmdProp.initializer.text;
                                                        } else if (cmdProp.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                                                            commandArg[cmdPropName] = true;
                                                        } else if (cmdProp.initializer.kind === ts.SyntaxKind.FalseKeyword) {
                                                            commandArg[cmdPropName] = false;
                                                        }
                                                    }
                                                });
                                                if (commandArg.name) { // Expects full name like "settings/index"
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
    if (appNavDeclaration && appNavDeclaration.initializer && ts.isArrayLiteralExpression(appNavDeclaration.initializer)) {
      appNavDeclaration.initializer.elements.forEach(rootNavNode => {
        if (ts.isObjectLiteralExpression(rootNavNode)) {
            const nameProp = rootNavNode.properties.find(p => p.name?.getText(sourceFile) === 'name');
            const rootName = (nameProp && ts.isPropertyAssignment(nameProp) && ts.isStringLiteral(nameProp.initializer)) ? nameProp.initializer.text : 'Root';
            const typeProp = rootNavNode.properties.find(p => p.name?.getText(sourceFile) === 'type');
            const rootType = (typeProp && ts.isPropertyAssignment(typeProp) && ts.isStringLiteral(typeProp.initializer)) ? typeProp.initializer.text : 'stack';
            extractScreensRecursive(rootNavNode, { name: rootName, type: rootType }); // Root parent name
        }
      });
    } else {
        console.warn("Could not find 'appNavigationStructure' or it's not an array. Screen parsing might be incomplete.");
    }

    return { screens: parsedScreens, isAutoSaveOn, isEditing, commandsToExecute, sourceFile }
  } catch (error) {
    console.error('Error parsing navigation config:', error.message)
    if (error instanceof SyntaxError || error.message.includes('SyntaxError')) {
      console.warn('Syntax error in navigation config, likely due to autosave. Skipping this change.')
      return null
    }
    return null
  }
}

function identifyChanges(currentConfigScreens, previousConfigScreens) {
  const newScreens = []
  const deletedScreens = []
  const updatedScreens = []
  const renamedScreens = []

  // Key is parentConfigName + currentConfigName (e.g. "(tabs)-(home)/index")
  const currentScreenMap = new Map(currentConfigScreens?.map((s) => [`${s.parent.name}-${s.name}`, s]) || [])
  const previousScreenMap = new Map(previousConfigScreens?.map((s) => [`${s.parent.name}-${s.name}`, s]) || [])

  const processedAsRenameNewKeys = new Set()
  const processedAsRenameOldKeys = new Set()

  for (const [prevKey, prevScreen] of previousScreenMap) {
    if (!currentScreenMap.has(prevKey)) {
      for (const [currKey, currScreen] of currentScreenMap) {
        if (!previousScreenMap.has(currKey) && currScreen.componentName === prevScreen.componentName && !processedAsRenameNewKeys.has(currKey)) {
          renamedScreens.push({ oldScreen: prevScreen, newScreen: currScreen })
          processedAsRenameOldKeys.add(prevKey)
          processedAsRenameNewKeys.add(currKey)
          break
        }
      }
    }
  }

  for (const [key, currentScreen] of currentScreenMap) {
    if (previousScreenMap.has(key) && !processedAsRenameNewKeys.has(key)) {
      const previousScreen = previousScreenMap.get(key)
      const relevantPropsChanged = currentScreen.componentName !== previousScreen.componentName ||
                                   currentScreen.title !== previousScreen.title ||
                                   currentScreen.icon !== previousScreen.icon ||
                                   currentScreen.label !== previousScreen.label ||
                                   currentScreen.href !== previousScreen.href ||
                                   JSON.stringify(currentScreen.showOn) !== JSON.stringify(previousScreen.showOn); // Check showOn
      if (relevantPropsChanged) {
        updatedScreens.push({ oldScreen: previousScreen, newScreen: currentScreen })
      }
    }
  }

  for (const [key, currentScreen] of currentScreenMap) {
    if (!previousScreenMap.has(key) && !processedAsRenameNewKeys.has(key)) {
      newScreens.push(currentScreen)
    }
  }

  for (const [key, previousScreen] of previousScreenMap) {
    if (!currentScreenMap.has(key) && !processedAsRenameOldKeys.has(key)) {
      deletedScreens.push(previousScreen)
    }
  }
  return { newScreens, deletedScreens, updatedScreens, renamedScreens }
}

// --- File System Functions ---
function getScreenPaths(configScreenName, parent) { // configScreenName is like "settings/index" or "(home)/index"
  const routeSegmentName = getRouteSegmentName(configScreenName); // e.g., "settings", "(home)"
  const featureFolderName = getRouteSegmentName(configScreenName); // Use getRouteSegmentName for feature folder name as it can contain ()

  const featurePath = path.join(FEATURES_PATH, featureFolderName);

  if (!parent || !parent.name || !parent.type) {
    console.warn(`Parent info incomplete for screen '${configScreenName}'. File paths might be incorrect for Expo/Web.`);
    return { featurePath, expoScreenDir: null, expoFilePath: null, webPageDir: null, webPagePath: null };
  }
  
  let expoParentPathSegments = [];
  let webParentPathSegments = [];

  // Parent name is also full name like "(tabs)" or "(drawer)"
  const parentRouteSegmentName = getRouteSegmentName(parent.name);

  if (parentRouteSegmentName === '(drawer)') {
    expoParentPathSegments.push('(drawer)');
    webParentPathSegments.push('(drawer)');
  } else if (parentRouteSegmentName === '(tabs)') {
    // Assuming (tabs) is always under (drawer) for path construction
    expoParentPathSegments.push('(drawer)', '(tabs)');
    webParentPathSegments.push('(drawer)', '(tabs)');
  } else if (parentRouteSegmentName === 'Root' && parent.type === 'stack') {
    // No specific sub-folder for Root itself
  } else if (parentRouteSegmentName) { // For any other named parent group
    expoParentPathSegments.push(parentRouteSegmentName);
    webParentPathSegments.push(parentRouteSegmentName);
  }


  const expoParentDir = path.join(EXPO_APP_PATH, ...expoParentPathSegments);
  const webParentDir = path.join(WEB_APP_PATH, ...webParentPathSegments);

  return {
    featurePath: featurePath,
    expoScreenDir: path.join(expoParentDir, routeSegmentName),
    expoFilePath: path.join(expoParentDir, routeSegmentName, 'index.tsx'),
    webPageDir: path.join(webParentDir, routeSegmentName), // Next.js uses routeSegmentName as dir
    webPagePath: path.join(webParentDir, routeSegmentName, 'page.tsx'),
  };
}

async function generateFeatureScreen(configScreenName, componentName, title, isUpdateOrRename = false, autoConfirm = false) {
  const featureFolderName = getRouteSegmentName(configScreenName); // e.g. "settings", "(home)"
  const cleanFeatureNameForDisplay = getCleanFeatureName(configScreenName); // e.g. "settings", "home"

  const featurePath = path.join(FEATURES_PATH, featureFolderName);
  const screenFilePath = path.join(featurePath, 'screen.tsx')
  const promptAction = isUpdateOrRename ? 'Update/overwrite' : 'Overwrite'

  if (await fs.pathExists(screenFilePath) && !autoConfirm) {
    const { overwrite } = await inquirer.default.prompt([ { type: 'confirm', name: 'overwrite', message: `Feature screen file ${screenFilePath} exists. ${promptAction}?`, default: isUpdateOrRename } ])
    if (!overwrite) { console.log(`Skipped ${promptAction}: ${screenFilePath}`); return null; }
  }

  await fs.ensureDir(featurePath)
  const content = `// packages/core/features/${featureFolderName}/screen.tsx
'use client';
import { View, Text } from 'react-native';
import { useColorScheme } from "react-native";

export function ${componentName}() {
  const colorScheme = useColorScheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: colorScheme === 'dark' ? '#121212' : '#FFFFFF' }}>
      <Text style={{ fontSize: 24, marginBottom: 10, color: colorScheme === 'dark' ? 'white' : 'black' }}>
        ${title || capitalizeFirstLetter(cleanFeatureNameForDisplay)}
      </Text>
      <Text style={{ fontSize: 12, color: colorScheme === 'dark' ? 'white' : 'black' }}>
        This screen was ${isUpdateOrRename ? 'updated/regenerated' : 'auto-generated'} by the CLI.
      </Text>
    </View>
  );
}`
  await fs.writeFile(screenFilePath, content)
  console.log(`${isUpdateOrRename ? 'Updated/Regenerated' : 'Generated'}: ${screenFilePath}`)
  return screenFilePath
}

async function generateExpoFile(configScreenName, componentName, parent, isUpdateOrRename = false, autoConfirm = false) {
  const { expoFilePath, expoScreenDir } = getScreenPaths(configScreenName, parent);
  const featureFolderName = getRouteSegmentName(configScreenName); // For import path
  const cleanRouteNameForComponent = getCleanFeatureName(configScreenName); // For Route function name

  if (!expoFilePath || !expoScreenDir) { console.warn(`Could not determine Expo path for ${configScreenName}.`); return null; }
  
  const promptAction = isUpdateOrRename ? 'Update/overwrite' : 'Overwrite'

  if (await fs.pathExists(expoFilePath) && !autoConfirm) {
    const { overwrite } = await inquirer.default.prompt([ { type: 'confirm', name: 'overwrite', message: `Expo file ${expoFilePath} exists. ${promptAction}?`, default: isUpdateOrRename } ])
    if (!overwrite) { console.log(`Skipped ${promptAction}: ${expoFilePath}`); return null; }
  }

  await fs.ensureDir(expoScreenDir); // Ensures directory like "settings" or "(home)" exists
  const content = `// ${path.relative(MONOREPO_ROOT, expoFilePath)}
import { ${componentName} } from '#features/${featureFolderName}/screen';

export default function ${capitalizeFirstLetter(cleanRouteNameForComponent)}Route() {
  return <${componentName} />;
}`;
  await fs.writeFile(expoFilePath, content);
  console.log(`${isUpdateOrRename ? 'Updated/Regenerated' : 'Generated'}: ${expoFilePath}`);
  return expoFilePath;
}

async function generateWebFile(configScreenName, componentName, parent, isUpdateOrRename = false, autoConfirm = false) {
  const { webPagePath, webPageDir } = getScreenPaths(configScreenName, parent);
  const featureFolderName = getRouteSegmentName(configScreenName); // For import path
  const cleanRouteNameForComponent = getCleanFeatureName(configScreenName); // For Page function name

  if (!webPagePath || !webPageDir) { console.warn(`Could not determine Web path for ${configScreenName}.`); return null; }
  
  const promptAction = isUpdateOrRename ? 'Update/overwrite' : 'Overwrite'

  if (await fs.pathExists(webPagePath) && !autoConfirm) {
      const { overwrite } = await inquirer.default.prompt([ { type: 'confirm', name: 'overwrite', message: `Web file ${webPagePath} exists. ${promptAction}?`, default: isUpdateOrRename } ])
      if (!overwrite) { console.log(`Skipped ${promptAction}: ${webPagePath}`); return null; }
  }

  await fs.ensureDir(webPageDir); // Ensures directory like "settings" or "(home)" exists
  const content = `// ${path.relative(MONOREPO_ROOT, webPagePath)}
'use client';
import { ${componentName} } from '#features/${featureFolderName}/screen';

export default function ${capitalizeFirstLetter(cleanRouteNameForComponent)}Page() {
  return <${componentName} />;
}`;
  await fs.writeFile(webPagePath, content);
  console.log(`${isUpdateOrRename ? 'Updated/Regenerated' : 'Generated'}: ${webPagePath}`);
  return webPagePath;
}

async function deleteScreenFiles(configScreenName, parent) {
    const { featurePath, expoScreenDir, webPageDir } = getScreenPaths(configScreenName, parent);
    const deletedPaths = [];

    if (featurePath && await fs.pathExists(featurePath)) { 
        await fs.remove(featurePath);
        console.log(`Deleted feature: ${featurePath}`);
        deletedPaths.push(featurePath);
    }
    if (expoScreenDir && await fs.pathExists(expoScreenDir)) { 
        await fs.remove(expoScreenDir);
        console.log(`Deleted Expo screen directory: ${expoScreenDir}`);
        deletedPaths.push(expoScreenDir);
    }
    if (webPageDir && await fs.pathExists(webPageDir)) { 
        await fs.remove(webPageDir);
        console.log(`Deleted Web directory: ${webPageDir}`);
        deletedPaths.push(webPageDir);
    }
    return deletedPaths;
}

async function renameScreenFiles(oldScreen, newScreen) {
    const { featurePath: oldFeaturePath, expoScreenDir: oldExpoScreenDir, webPageDir: oldWebPageDir } = getScreenPaths(oldScreen.name, oldScreen.parent);
    const { featurePath: newFeaturePath, expoScreenDir: newExpoScreenDir, webPageDir: newWebPageDir } = getScreenPaths(newScreen.name, newScreen.parent);
    
    const renamedPaths = [];

    if (oldFeaturePath && newFeaturePath && await fs.pathExists(oldFeaturePath)) {
        if (oldFeaturePath !== newFeaturePath) await fs.move(oldFeaturePath, newFeaturePath);
        console.log(`Handled feature dir rename/move: ${oldFeaturePath} -> ${newFeaturePath}`);
        renamedPaths.push(newFeaturePath);
    }
    if (oldExpoScreenDir && newExpoScreenDir && await fs.pathExists(oldExpoScreenDir)) {
        if (oldExpoScreenDir !== newExpoScreenDir) {
            await fs.ensureDir(path.dirname(newExpoScreenDir)); 
            await fs.move(oldExpoScreenDir, newExpoScreenDir);
        }
        console.log(`Handled Expo screen directory rename/move: ${oldExpoScreenDir} -> ${newExpoScreenDir}`);
        renamedPaths.push(newExpoScreenDir);
    }
    if (oldWebPageDir && newWebPageDir && await fs.pathExists(oldWebPageDir)) {
        if (oldWebPageDir !== newWebPageDir) {
            await fs.ensureDir(path.dirname(newWebPageDir));
            await fs.move(oldWebPageDir, newWebPageDir);
        }
        console.log(`Handled Web dir rename/move: ${oldWebPageDir} -> ${newWebPageDir}`);
        renamedPaths.push(newWebPageDir);
    }
    return renamedPaths;
}

async function modifyLayoutFileWithAst(actions) {
  const fileContent = await fs.readFile(NAVIGATION_CONFIG_PATH, 'utf-8')
  const sourceFile = ts.createSourceFile(
    path.basename(NAVIGATION_CONFIG_PATH),
    fileContent,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX
  )

  const transformResult = ts.transform(sourceFile, [
    (context) => {
      const { factory } = context
      const visit = (node) => {
        if (ts.isObjectLiteralExpression(node)) {
            const namePropNode = node.properties.find(p => p.name?.getText(sourceFile) === 'name');
            if (namePropNode && ts.isPropertyAssignment(namePropNode) && ts.isStringLiteral(namePropNode.initializer)) {
                const navigatorName = namePropNode.initializer.text; // This is parent navigator name e.g. "(tabs)"
                const screensToAddForThisNav = actions.screensToAdd?.filter(s => s.parentName === navigatorName) || [];
                const screenNamesToDeleteFromThisNav = new Set((actions.screenNamesToDelete?.filter(s => s.parentName === navigatorName) || []).map(s => s.name));

                if (screensToAddForThisNav.length > 0 || screenNamesToDeleteFromThisNav.size > 0) {
                    const screensPropNode = node.properties.find(p => p.name?.getText(sourceFile) === 'screens');
                    if (screensPropNode && ts.isPropertyAssignment(screensPropNode) && ts.isArrayLiteralExpression(screensPropNode.initializer)) {
                        let currentScreenElements = [...screensPropNode.initializer.elements];
                        if (screenNamesToDeleteFromThisNav.size > 0) {
                            currentScreenElements = currentScreenElements.filter(elNode => {
                                if (ts.isObjectLiteralExpression(elNode)) {
                                    const screenNameProp = elNode.properties.find(p => p.name?.getText(sourceFile) === 'name');
                                    if (screenNameProp && ts.isPropertyAssignment(screenNameProp) && ts.isStringLiteral(screenNameProp.initializer)) {
                                        return !screenNamesToDeleteFromThisNav.has(screenNameProp.initializer.text);
                                    }
                                }
                                return true;
                            });
                        }
                        if (screensToAddForThisNav.length > 0) {
                            screensToAddForThisNav.forEach(screenDetail => { // screenDetail.name is full "name/index"
                                const typePropNode = node.properties.find(p => p.name?.getText(sourceFile) === 'type');
                                if (typePropNode && ts.isPropertyAssignment(typePropNode) && ts.isStringLiteral(typePropNode.initializer)) {
                                      screenDetail.parentType = typePropNode.initializer.text;
                                }
                                currentScreenElements.push(createScreenAstNode(factory, screenDetail));
                            });
                        }
                        const newScreensArray = factory.updateArrayLiteralExpression(screensPropNode.initializer, currentScreenElements);
                        return factory.updateObjectLiteralExpression(node, node.properties.map(p => p === screensPropNode ? factory.updatePropertyAssignment(screensPropNode, screensPropNode.name, newScreensArray) : p));
                    }
                }
            }
        }
        if (actions.clearCommands && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'commandsToExecute') {
            return factory.updateVariableDeclaration(
                node, node.name, node.exclamationToken, node.type,
                factory.createObjectLiteralExpression([
                    factory.createPropertyAssignment('add', factory.createArrayLiteralExpression([], true)),
                    factory.createPropertyAssignment('delete', factory.createArrayLiteralExpression([], true)),
                ], true)
            );
        }
        return ts.visitEachChild(node, visit, context);
      }

      return (sf) => {
        let statements = [...sf.statements];
        let existingImports = statements.filter(ts.isImportDeclaration);
        const otherStatements = statements.filter(s => !ts.isImportDeclaration(s));
        let importsChanged = false;

        if (actions.importsToRemove?.length > 0) {
            const componentsToRemove = new Set(actions.importsToRemove.map(imp => imp.componentName).filter(Boolean));
            if (componentsToRemove.size > 0) {
                const newImportsList = [];
                let localImportsChanged = false;
                existingImports.forEach(importDecl => {
                    if (importDecl.importClause?.namedBindings && ts.isNamedImports(importDecl.importClause.namedBindings)) {
                        const originalElements = importDecl.importClause.namedBindings.elements;
                        const newElements = originalElements.filter(el => !componentsToRemove.has(el.name.text));
                        if (newElements.length < originalElements.length) {
                           localImportsChanged = true;
                           if (newElements.length > 0) {
                                const updatedBinding = factory.updateNamedImports(importDecl.importClause.namedBindings, newElements);
                                const updatedClause = factory.updateImportClause(importDecl.importClause, importDecl.importClause.isTypeOnly, importDecl.importClause.name, updatedBinding);
                                newImportsList.push(factory.updateImportDeclaration(importDecl, importDecl.modifiers, importDecl.modifiers, updatedClause, importDecl.moduleSpecifier, importDecl.assertClause));
                           }
                        } else newImportsList.push(importDecl);
                    } else newImportsList.push(importDecl);
                });
                if (localImportsChanged) { existingImports = newImportsList; importsChanged = true; }
            }
        }

        if (actions.importsToAdd?.length > 0) {
          actions.importsToAdd.forEach((imp) => { // imp.screenName is the featureFolderName (e.g., (home) or settings)
            if (!imp.componentName || !imp.screenName || !/^[a-zA-Z_$][a-zA-Z\d_$()]*$/.test(imp.componentName) || !/^[a-zA-Z0-9_().-]+$/.test(imp.screenName)) {
                console.warn(`AST: Invalid import details: ComponentName: ${imp.componentName}, ScreenName (Feature): ${imp.screenName}`); return;
            }
            const relativePath = `#features/${imp.screenName}/screen`; 
            const alreadyExists = existingImports.some(i => i.importClause?.namedBindings && ts.isNamedImports(i.importClause.namedBindings) &&
                                                        i.importClause.namedBindings.elements.some(el => el.name.text === imp.componentName) &&
                                                        ts.isStringLiteral(i.moduleSpecifier) && i.moduleSpecifier.text === relativePath);
            if (!alreadyExists) {
                const newImportSpecifier = factory.createImportSpecifier(false, undefined, factory.createIdentifier(imp.componentName));
                const newNamedImports = factory.createNamedImports([newImportSpecifier]);
                const newImportClause = factory.createImportClause(false, undefined, newNamedImports);
                existingImports.push(factory.createImportDeclaration(undefined, undefined, newImportClause, factory.createStringLiteral(relativePath), undefined));
                importsChanged = true;
            }
          });
        }

        const transformedOtherStatements = ts.visitNodes(factory.createNodeArray(otherStatements), visit, context);

        if(importsChanged) {
             return factory.updateSourceFile(sf, [...existingImports, ...transformedOtherStatements]);
        }
        const bodyTransformed = ts.visitNodes(factory.createNodeArray(otherStatements), visit, context);
        return factory.updateSourceFile(sf, [...existingImports, ...bodyTransformed]);
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
    console.warn('processBatchOfChanges called while actionInProgress was already true. This is unexpected.')
    reevaluateAfterCompletion = true
    return false;
  }
  actionInProgress = true;
  let astModifiedInThisBatch = false;

  try {
    const { newScreens, deletedScreens, updatedScreens, renamedScreens } = identifyChanges(
      currentScreensFromParse,
      lastAcknowledgedConfigState?.screens
    )

    const hasAnyChanges = newScreens.length > 0 || deletedScreens.length > 0 || updatedScreens.length > 0 || renamedScreens.length > 0

    if (!hasAnyChanges) {
      console.log('No actionable screen changes to process relative to last acknowledged state.')
      lastAcknowledgedConfigState = { screens: currentScreensFromParse }
      actionInProgress = false; return false;
    }

    let promptMessage = 'The following changes are detected based on your latest edits:\n'
    if (deletedScreens.length > 0) promptMessage += `  - DELETIONS: ${deletedScreens.map((s) => `${s.name} (from ${s.parent.name})`).join(', ')}\n`
    if (renamedScreens.length > 0) promptMessage += `  - RENAMES: ${renamedScreens.map((r) => `'${r.oldScreen.name}' (in ${r.oldScreen.parent.name}) to '${r.newScreen.name}' (in ${r.newScreen.parent.name})`).join(', ')}\n`
    if (updatedScreens.length > 0) promptMessage += `  - UPDATES: ${updatedScreens.map((u) => `${u.newScreen.name} (in ${u.newScreen.parent.name})`).join(', ')}\n`
    if (newScreens.length > 0) promptMessage += `  - ADDITIONS: ${newScreens.map((s) => `${s.name} (in ${s.parent.name})`).join(', ')}\n`
    promptMessage += 'Do you want to proceed with these changes now?'

    const { confirmProcessNow } = await inquirer.default.prompt([{ type: 'confirm', name: 'confirmProcessNow', message: promptMessage, default: true },])

    if (!confirmProcessNow) {
      console.log('User chose not to process accumulated changes now.')
      actionInProgress = false; return false;
    }

    let changesEffectivelyMade = false
    const allGeneratedOrModifiedFiles = new Set();
    const astModificationsBatch = { screensToAdd: [], screenNamesToDelete: [], importsToAdd: [], importsToRemove: [] };

    for (const screen of deletedScreens) { // screen.name is full "name/index"
      console.log(`\nProcessing DELETION for screen: ${screen.name} in ${screen.parent.name}`);
      const deletedFilePaths = await deleteScreenFiles(screen.name, screen.parent);
      deletedFilePaths.forEach(p => allGeneratedOrModifiedFiles.add(p));
      astModificationsBatch.screenNamesToDelete.push({ name: screen.name, parentName: screen.parent.name });
      if (screen.componentName) astModificationsBatch.importsToRemove.push({ componentName: screen.componentName });
      changesEffectivelyMade = true;
    }

    for (const { oldScreen, newScreen } of renamedScreens) { // names are full "name/index"
        console.log(`\nProcessing RENAME for '${oldScreen.name}' to '${newScreen.name}' (parent: ${oldScreen.parent.name} -> ${newScreen.parent.name})`);
        const renamedFilePaths = await renameScreenFiles(oldScreen, newScreen);
        renamedFilePaths.forEach(p => allGeneratedOrModifiedFiles.add(p));

        const featureP = await generateFeatureScreen(newScreen.name, newScreen.componentName, newScreen.title || getCleanFeatureName(newScreen.name), true, true);
        if(featureP) allGeneratedOrModifiedFiles.add(featureP);
        const expoP = await generateExpoFile(newScreen.name, newScreen.componentName, newScreen.parent, true, true);
        if(expoP) allGeneratedOrModifiedFiles.add(expoP);
        const webP = await generateWebFile(newScreen.name, newScreen.componentName, newScreen.parent, true, true);
        if(webP) allGeneratedOrModifiedFiles.add(webP);

        astModificationsBatch.screenNamesToDelete.push({ name: oldScreen.name, parentName: oldScreen.parent.name });
        if (oldScreen.componentName) astModificationsBatch.importsToRemove.push({ componentName: oldScreen.componentName });

        astModificationsBatch.screensToAdd.push({ ...newScreen, parentName: newScreen.parent.name, parentType: newScreen.parent.type });
        astModificationsBatch.importsToAdd.push({ componentName: newScreen.componentName, screenName: getRouteSegmentName(newScreen.name) }); // Use getRouteSegmentName for feature folder
        changesEffectivelyMade = true;
    }

    for (const { oldScreen, newScreen } of updatedScreens) { // names are full "name/index"
        console.log(`\nProcessing UPDATE for screen: ${newScreen.name} in ${newScreen.parent.name}`);
        if (oldScreen.parent.name !== newScreen.parent.name || oldScreen.name !== newScreen.name) {
            const renamedFilePaths = await renameScreenFiles(oldScreen, newScreen);
            renamedFilePaths.forEach(p => allGeneratedOrModifiedFiles.add(p));
        }
        const featureP = await generateFeatureScreen(newScreen.name, newScreen.componentName, newScreen.title || getCleanFeatureName(newScreen.name), true, true);
        if(featureP) allGeneratedOrModifiedFiles.add(featureP);
        const expoP = await generateExpoFile(newScreen.name, newScreen.componentName, newScreen.parent, true, true);
        if(expoP) allGeneratedOrModifiedFiles.add(expoP);
        const webP = await generateWebFile(newScreen.name, newScreen.componentName, newScreen.parent, true, true);
        if(webP) allGeneratedOrModifiedFiles.add(webP);

        astModificationsBatch.screenNamesToDelete.push({ name: oldScreen.name, parentName: oldScreen.parent.name });
        if (oldScreen.componentName && oldScreen.componentName !== newScreen.componentName) {
            astModificationsBatch.importsToRemove.push({ componentName: oldScreen.componentName });
        }

        astModificationsBatch.screensToAdd.push({ ...newScreen, parentName: newScreen.parent.name, parentType: newScreen.parent.type });
        if (!astModificationsBatch.importsToAdd.find(i => i.componentName === newScreen.componentName && i.screenName === getRouteSegmentName(newScreen.name))) { // Use getRouteSegmentName for feature folder
            astModificationsBatch.importsToAdd.push({ componentName: newScreen.componentName, screenName: getRouteSegmentName(newScreen.name) });
        }
        changesEffectivelyMade = true;
    }

    for (const screen of newScreens) { // screen.name is full "name/index"
      console.log(`\nProcessing ADDITION for screen: ${screen.name} in ${screen.parent.name}`);
      const cleanFeatureNameForComponent = getCleanFeatureName(screen.name);
      const componentName = screen.componentName || capitalizeFirstLetter(cleanFeatureNameForComponent) + 'Screen';
      
      const featureP = await generateFeatureScreen(screen.name, componentName, screen.title || cleanFeatureNameForComponent, false, true);
      if(featureP) allGeneratedOrModifiedFiles.add(featureP);
      const expoP = await generateExpoFile(screen.name, componentName, screen.parent, false, true);
      if(expoP) allGeneratedOrModifiedFiles.add(expoP);
      const webP = await generateWebFile(screen.name, componentName, screen.parent, false, true);
      if(webP) allGeneratedOrModifiedFiles.add(webP);
      
      astModificationsBatch.importsToAdd.push({ componentName: componentName, screenName: getRouteSegmentName(screen.name) }); // Use getRouteSegmentName for feature folder
      changesEffectivelyMade = true;
    }

    if (changesEffectivelyMade && (astModificationsBatch.screensToAdd.length > 0 || astModificationsBatch.screenNamesToDelete.length > 0 || astModificationsBatch.importsToAdd.length > 0 || astModificationsBatch.importsToRemove.length > 0)) {
      await modifyLayoutFileWithAst(astModificationsBatch);
      astModifiedInThisBatch = true;
    }


    if (changesEffectivelyMade || ignoreNextConfigChange) { 
      const finalLayoutState = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (finalLayoutState?.screens) {
        lastAcknowledgedConfigState = { screens: finalLayoutState.screens };
      } else {
        lastAcknowledgedConfigState = { screens: currentScreensFromParse }; 
      }
      console.log("Snapshot `lastAcknowledgedConfigState` updated.");

      const filesToCommit = [NAVIGATION_CONFIG_PATH, ...allGeneratedOrModifiedFiles];
      const uniqueFiles = [...new Set(filesToCommit.filter(Boolean))];

      if (uniqueFiles.length > 0) {
        // Git commit prompt
      }
    }

  } catch (error) {
    console.error('An error occurred during processBatchOfChanges:', error);
  } finally {
    actionInProgress = false;
    if (reevaluateAfterCompletion) {
      reevaluateAfterCompletion = false;
      setImmediate(() => onConfigFileChanged(NAVIGATION_CONFIG_PATH));
    }
  }
  return astModifiedInThisBatch;
}


async function getExistingScreenDirectories() {
  const screens = { features: new Set(), expo: new Map(), web: new Map() };

  if (await fs.pathExists(FEATURES_PATH)) {
      const featureItems = await fs.readdir(FEATURES_PATH);
      for (const item of featureItems) { 
          if ((await fs.stat(path.join(FEATURES_PATH, item))).isDirectory() && await fs.pathExists(path.join(FEATURES_PATH, item, 'screen.tsx'))) {
              screens.features.add(item); 
          }
      }
  }

  const scanAppDirRecursive = async (currentDir, platformMap, parentPathSegments = []) => {
      if (!await fs.pathExists(currentDir)) return;
      const items = await fs.readdir(currentDir, { withFileTypes: true });
      // currentParentKey is the direct filesystem parent directory name, e.g., "(tabs)", "(drawer)"
      const currentParentKey = parentPathSegments.length > 0 ? parentPathSegments[parentPathSegments.length -1] : path.basename(MONOREPO_ROOT); // Fallback for top level

      for (const item of items) {
          const itemName = item.name; 
          const itemPath = path.join(currentDir, itemName);

          if (itemName.startsWith('_') || itemName.startsWith('.')) {
              continue;
          }

          if (item.isDirectory()) {
              const indexFile = (platformMap === screens.expo) ? 'index.tsx' : 'page.tsx';
              if (await fs.pathExists(path.join(itemPath, indexFile))) {
                  // Store the screen name as it appears in config: "segmentName/index"
                  const screenNameAsInConfig = `${itemName}/index`; 
                  if (!platformMap.has(currentParentKey)) platformMap.set(currentParentKey, new Set());
                  platformMap.get(currentParentKey).add(screenNameAsInConfig);
              }

              // Recurse into layout groups like (tabs), (drawer)
              if (itemName.startsWith('(') && itemName.endsWith(')')) { 
                  await scanAppDirRecursive(itemPath, platformMap, [...parentPathSegments, itemName]);
              }
          }
      }
  };
  
  // Start scanning from the app's root directory for groups like (drawer)
  const expoAppRootItems = await fs.pathExists(EXPO_APP_PATH) ? await fs.readdir(EXPO_APP_PATH, { withFileTypes: true }) : [];
  for (const item of expoAppRootItems) {
      if (item.isDirectory() && item.name.startsWith('(') && item.name.endsWith(')')) {
          await scanAppDirRecursive(path.join(EXPO_APP_PATH, item.name), screens.expo, [item.name]);
      }
  }

  const webAppRootItems = await fs.pathExists(WEB_APP_PATH) ? await fs.readdir(WEB_APP_PATH, { withFileTypes: true }) : [];
  for (const item of webAppRootItems) {
      if (item.isDirectory() && item.name.startsWith('(') && item.name.endsWith(')')) {
          await scanAppDirRecursive(path.join(WEB_APP_PATH, item.name), screens.web, [item.name]);
      }
  }
  return screens;
}


function getLayoutImports(sourceFile) {
  const imports = [];
  if (!sourceFile) return imports;
  
  sourceFile.statements.forEach(statement => {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = statement.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpecifier)) {
        const importPath = moduleSpecifier.text;
        // Regex matches #features/ANYTHING_WITH_PARENS_HYPHENS_ETC/screen
        const match = importPath.match(/features\/([a-zA-Z0-9_().-]+)\/screen$/);
        
        if (match) {
          const featureFolderNameFromImport = match[1]; // This is the name used in #features/...
          if (statement.importClause && statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
            statement.importClause.namedBindings.elements.forEach(element => {
              imports.push({ componentName: element.name.text, featureFolderName: featureFolderNameFromImport });
            });
          }
        }
      }
    }
  });
  return imports;
}


async function validateProjectConsistency(declaredScreens, layoutSourceFile, isInteractive = true) {
  console.log("🕵️ Running project consistency validation...");
  let fixesAppliedThisRun = false;
  let astModifiedThisRun = false;
  const proposedFixes = [];

  if (!declaredScreens || !layoutSourceFile) {
    console.error("Validation error: Missing declaredScreens or layoutSourceFile for validation.");
    return { fixesApplied: false, astModified: false };
  }

  const { features: actualFeatureDirs, expo: actualExpoScreensByParent, web: actualWebScreensByParent } = await getExistingScreenDirectories();
  const actualImports = getLayoutImports(layoutSourceFile) || [];

  for (const screen of declaredScreens) { // screen.name is "configName/index"
    if (!screen.name || !screen.componentName || !screen.parent || !screen.parent.name) {
      console.warn(`Validator: Skipping screen with incomplete data: ${JSON.stringify(screen)}`);
      continue;
    }
    // featureFolderName is like "(home)" or "settings" - used for #features/[featureFolderName]/screen
    const featureFolderNameForImport = getRouteSegmentName(screen.name); 
    
    if (!actualFeatureDirs.has(featureFolderNameForImport)) {
      proposedFixes.push({ description: `Screen '${screen.name}': Missing feature directory for '${featureFolderNameForImport}'.`, action: () => generateFeatureScreen(screen.name, screen.componentName, screen.title), type: 'file', fixType: 'generate_feature' });
    }
    
    // parent.name is like "(tabs)" or "(drawer)"
    const parentRouteSegment = getRouteSegmentName(screen.parent.name);
    const expoParentScreens = actualExpoScreensByParent.get(parentRouteSegment);
    
    // screen.name is already "name/index" as per config
    if (!expoParentScreens || !expoParentScreens.has(screen.name)) {
        proposedFixes.push({ description: `Screen '${screen.name}' in Expo parent '${screen.parent.name}': Missing Expo file.`, action: () => generateExpoFile(screen.name, screen.componentName, screen.parent), type: 'file', fixType: 'generate_expo' });
    }

    const webParentScreens = actualWebScreensByParent.get(parentRouteSegment);
    if (!webParentScreens || !webParentScreens.has(screen.name)) { 
        proposedFixes.push({ description: `Screen '${screen.name}' in Web parent '${screen.parent.name}': Missing Web file.`, action: () => generateWebFile(screen.name, screen.componentName, screen.parent), type: 'file', fixType: 'generate_web' });
    }

    const hasCorrectImport = actualImports.some(imp => imp.componentName === screen.componentName && imp.featureFolderName === featureFolderNameForImport);
    if (!hasCorrectImport) {
      // For add_import, screenData.screenName should be the featureFolderName for the path #features/[screenName]/screen
      proposedFixes.push({ description: `Screen '${screen.name}': Missing import for '${screen.componentName}' from feature '${featureFolderNameForImport}'.`, type: 'ast', fixType: 'add_import', screenData: { componentName: screen.componentName, screenName: featureFolderNameForImport } });
    }
  }

  actualFeatureDirs.forEach(featureDirName => { 
    if (!declaredScreens.some(s => getRouteSegmentName(s.name) === featureDirName)) {
      const dummyConfigScreenName = `${featureDirName}/index`; 
      proposedFixes.push({ description: `Orphaned feature: '${featureDirName}'.`, action: () => deleteScreenFiles(dummyConfigScreenName, {name: 'unknown_feature_parent', type: 'unknown'}), type: 'file', fixType: 'delete_feature' });
    }
  });

  actualExpoScreensByParent.forEach((screenNameSet, parentRouteSegmentNameFromFile) => {
      screenNameSet.forEach(configScreenNameFromFile => { // e.g. "settings/index"
          // Find a declared parent navigator whose route segment matches parentRouteSegmentNameFromFile
          const declaredParent = declaredScreens.find(s => s.type !== 'screen' && getRouteSegmentName(s.name) === parentRouteSegmentNameFromFile);
          const parentConfigNameToMatch = declaredParent ? declaredParent.name : parentRouteSegmentNameFromFile; // Fallback if direct parent not in config (e.g. 'Root')

          if (!declaredScreens.some(s => s.name === configScreenNameFromFile && s.parent.name === parentConfigNameToMatch)) {
              proposedFixes.push({ description: `Orphaned Expo screen: '${configScreenNameFromFile}' in parent group '${parentRouteSegmentNameFromFile}'.`, action: () => deleteScreenFiles(configScreenNameFromFile, {name: parentConfigNameToMatch, type: 'unknown_expo_parent'}), type: 'file', fixType: 'delete_expo' });
          }
      });
  });
  actualWebScreensByParent.forEach((screenNameSet, parentRouteSegmentNameFromFile) => {
    screenNameSet.forEach(configScreenNameFromFile => {
        const declaredParent = declaredScreens.find(s => s.type !== 'screen' && getRouteSegmentName(s.name) === parentRouteSegmentNameFromFile);
        const parentConfigNameToMatch = declaredParent ? declaredParent.name : parentRouteSegmentNameFromFile;

        if (!declaredScreens.some(s => s.name === configScreenNameFromFile && s.parent.name === parentConfigNameToMatch)) {
            proposedFixes.push({ description: `Orphaned Web page: '${configScreenNameFromFile}' in parent group '${parentRouteSegmentNameFromFile}'.`, action: () => deleteScreenFiles(configScreenNameFromFile, {name: parentConfigNameToMatch, type: 'unknown_web_parent'}), type: 'file', fixType: 'delete_web' });
        }
    });
  });

  actualImports.forEach(imp => { 
    if (!declaredScreens.some(s => s.componentName === imp.componentName && getRouteSegmentName(s.name) === imp.featureFolderName)) {
      proposedFixes.push({ description: `Orphaned import: '${imp.componentName}' from '#features/${imp.featureFolderName}/screen'.`, type: 'ast', fixType: 'remove_import', screenData: { componentName: imp.componentName } });
    }
  });

  if (proposedFixes.length === 0) {
    console.log("✅ Project consistency validation passed.");
    return { fixesApplied: false, astModified: false };
  }

  console.warn("\nProject Consistency Discrepancies Found:");
  const choices = proposedFixes.map((fix, index) => ({ name: `${fix.description} (Action: ${fix.fixType.replace(/_/g, ' ')})`, value: index, checked: true }));

  if (!isInteractive) {
    console.log("Non-interactive mode. Skipping automatic fixes.");
    return { fixesApplied: false, astModified: false };
  }

  const { selectedFixIndices } = await inquirer.default.prompt([ { type: 'checkbox', name: 'selectedFixIndices', message: 'Select fixes to apply:', choices: choices, pageSize: Math.min(choices.length, 20) }, ]);

  if (!selectedFixIndices || selectedFixIndices.length === 0) {
    console.log("No fixes selected by user.");
    return { fixesApplied: false, astModified: false };
  }

  const astActionsForBatch = { importsToAdd: [], importsToRemove: []}; // Removed screensToAdd, screenNamesToDelete, clearCommands

  for (const index of selectedFixIndices) {
    const fix = proposedFixes[index];
    console.log(`Applying: ${fix.description}`);
    if (fix.type === 'file' && fix.action) {
      try { await fix.action(); fixesAppliedThisRun = true; } catch (e) { console.error(`Error applying file fix: ${fix.description}`, e); }
    } else if (fix.type === 'ast') {
      if (fix.fixType === 'add_import' && fix.screenData) astActionsForBatch.importsToAdd.push(fix.screenData); 
      else if (fix.fixType === 'remove_import' && fix.screenData) astActionsForBatch.importsToRemove.push(fix.screenData);
    }
  }

  if (astActionsForBatch.importsToAdd.length > 0 || astActionsForBatch.importsToRemove.length > 0) {
    console.log("Applying batched AST modifications for imports...");
    try { await modifyLayoutFileWithAst(astActionsForBatch); astModifiedThisRun = true; fixesAppliedThisRun = true; } catch (e) { console.error("Error applying AST fixes:", e); }
  }

  if (fixesAppliedThisRun) console.log("Consistency fixes applied.");
  else console.log("No fixes were applied.");
  return { fixesApplied: fixesAppliedThisRun, astModified: astModifiedThisRun };
}

// --- onConfigFileChanged ---
async function onConfigFileChanged(changedPath) {
  if (actionInProgress) {
    console.log('An operation batch is already in progress. Queuing re-evaluation...')
    reevaluateAfterCompletion = true
    return
  }

  if (changedPath === NAVIGATION_CONFIG_PATH && ignoreNextConfigChange) {
    console.log('Ignoring this config change as it was programmatic.')
    ignoreNextConfigChange = false
    try {
      const updatedConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (updatedConfig && updatedConfig.screens) {
        lastAcknowledgedConfigState = { screens: updatedConfig.screens };
        console.log("Refreshed lastAcknowledgedConfigState after programmatic change.");
      }
    } catch (e) { console.error("Error refreshing lastAcknowledgedConfigState:", e); }
    return
  }

  console.log(`Change detected in ${NAVIGATION_CONFIG_PATH}. Parsing...`)
  let parsedResult = await parseNavigationConfig(NAVIGATION_CONFIG_PATH)

  if (!parsedResult) {
    console.warn('Could not parse navigation config. Waiting for next valid change.')
    editingModeActive = false
    return
  }

  let currentScreensFromFile = parsedResult.screens;
  let astModifiedByCommands = false;

  const { isAutoSaveOn, isEditing, commandsToExecute } = parsedResult;
  console.log(`Parsed flags from file: isAutoSaveOn=${isAutoSaveOn}, isEditing=${isEditing}`)
  const hasPendingCliCommands = commandsToExecute && (commandsToExecute.add?.length > 0 || commandsToExecute.delete?.length > 0)

  if (isAutoSaveOn) {
    if (isEditing && !hasPendingCliCommands) {
      if (!editingModeActive) {
        console.log('Autosave ON, `isEditing` true (no commands). Entering editing mode.')
        editingModeActive = true
      } else {
        console.log('Still in editing mode (Autosave ON, `isEditing` true, no commands).')
      }
      return
    } else {
      if (editingModeActive && !isEditing) {
        console.log('`isEditing` is now false. Processing changes.')
        editingModeActive = false
      } else if (!editingModeActive && !isEditing && isAutoSaveOn) {
        console.log('Autosave ON, `isEditing` false. Processing changes.');
      }
    }
  } else {
    if (editingModeActive) {
      console.log('Autosave OFF. Exiting editing mode and processing changes.')
      editingModeActive = false
    }
  }

  if (hasPendingCliCommands) {
    console.log('Applying commands from `commandsToExecute` in layout.tsx...')
    const actionsForAst = { screensToAdd: [], screenNamesToDelete: [], importsToAdd: [], importsToRemove: [], clearCommands: true };

    for(const cmd of (commandsToExecute.add || [])) { 
        const { parentName } = await inquirer.default.prompt([ { type: 'list', name: 'parentName', message: `Command: Add '${cmd.name}'. Which parent navigator?`, choices: [{name: '(drawer)', value: '(drawer)'}, {name: '(tabs)', value: '(tabs)'}] }]);
        const parentType = parentName === '(tabs)' ? 'tabs' : 'drawer'; 
        const cleanFeatureName = getCleanFeatureName(cmd.name);
        const componentName = cmd.componentName || capitalizeFirstLetter(cleanFeatureName) + 'Screen';
        
        actionsForAst.screensToAdd.push({ name: cmd.name, componentName, title: cmd.title, icon: cmd.icon, label: cmd.label, href: cmd.href, parentName, parentType });
        actionsForAst.importsToAdd.push({ componentName, screenName: getRouteSegmentName(cmd.name) }); // Use getRouteSegmentName for feature folder
    }
    for(const cmd of (commandsToExecute.delete || [])) { 
        const { parentName } = await inquirer.default.prompt([ { type: 'list', name: 'parentName', message: `Command: Delete '${cmd.name}'. Which parent navigator?`, choices: [{name: '(drawer)', value: '(drawer)'}, {name: '(tabs)', value: '(tabs)'}] }]);
        const screenInLayout = currentScreensFromFile.find(s => s.name === cmd.name && s.parent.name === parentName);
        const componentName = cmd.componentName || (screenInLayout ? screenInLayout.componentName : null);
        actionsForAst.screenNamesToDelete.push({ name: cmd.name, parentName: parentName });
        if (componentName) actionsForAst.importsToRemove.push({ componentName });
    }

    if (actionsForAst.screensToAdd.length > 0 || actionsForAst.screenNamesToDelete.length > 0 || actionsForAst.importsToAdd.length > 0 || actionsForAst.importsToRemove.length > 0) {
      await modifyLayoutFileWithAst(actionsForAst);
      astModifiedByCommands = true;
      const newParsedResult = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (newParsedResult) {
        parsedResult = newParsedResult;
        currentScreensFromFile = newParsedResult.screens;
      } else {
        console.error('Failed to re-parse layout.tsx after applying commands. Aborting further processing.');
        return;
      }
      lastAcknowledgedConfigState = { screens: currentScreensFromFile };
      console.log("Applied commands from layout.tsx and updated internal state.");
    } else if (actionsForAst.clearCommands && (commandsToExecute.add?.length > 0 || commandsToExecute.delete?.length > 0)) {
      console.log("Clearing empty or ineffective commandsToExecute from layout.tsx.");
      await modifyLayoutFileWithAst({ clearCommands: true });
      astModifiedByCommands = true;
      const newParsedResult = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (newParsedResult) {
          parsedResult = newParsedResult;
          currentScreensFromFile = newParsedResult.screens;
          lastAcknowledgedConfigState = { screens: currentScreensFromFile };
      }
    } else {
        console.log("No effective AST changes from commandsToExecute. Only clearing the commands array.");
        await modifyLayoutFileWithAst({ clearCommands: true });
        astModifiedByCommands = true; 
    }
  }

  const astModifiedByBatch = await processBatchOfChanges(currentScreensFromFile);
  const astModifiedThisCycle = astModifiedByCommands || astModifiedByBatch;

  console.log("Running post-change consistency validation...");
  let configForValidation = parsedResult;
  if (astModifiedThisCycle) { 
    const freshConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (freshConfig) configForValidation = freshConfig;
    else console.warn("Could not re-parse for validation after potential AST modifications in the cycle.");
  }

  if (configForValidation && configForValidation.screens && configForValidation.sourceFile) {
    const validationResult = await validateProjectConsistency(configForValidation.screens, configForValidation.sourceFile);
    if (validationResult.astModified || validationResult.fixesApplied) {
      const finalConfigAfterValidation = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (finalConfigAfterValidation?.screens) {
        lastAcknowledgedConfigState = { screens: finalConfigAfterValidation.screens };
        console.log("Refreshed lastAcknowledgedConfigState after validation fixes.");
      }
    } else {
        if(configForValidation.screens) {
             lastAcknowledgedConfigState = { screens: configForValidation.screens };
        }
    }
  } else {
    console.warn("Could not obtain suitable config for post-change validation.");
    if (!astModifiedThisCycle && currentScreensFromFile) {
        lastAcknowledgedConfigState = { screens: currentScreensFromFile };
    }
  }
}

// --- Main Execution ---
async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  let initialConfigResult;
  try {
    initialConfigResult = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (initialConfigResult && initialConfigResult.screens && initialConfigResult.sourceFile) {
      lastAcknowledgedConfigState = { screens: initialConfigResult.screens };
      console.log('Initial navigation config parsed and stored.');
      console.log('Performing initial project consistency validation...');
      const validationResult = await validateProjectConsistency(initialConfigResult.screens, initialConfigResult.sourceFile);
      if (validationResult.astModified || validationResult.fixesApplied) {
        console.log("Consistency fixes applied during startup. Re-parsing config...");
        const updatedConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
        if (updatedConfig?.screens) {
          lastAcknowledgedConfigState = { screens: updatedConfig.screens };
          initialConfigResult = updatedConfig; 
        } else console.error("Failed to re-parse config after initial validation fixes.");
      }
    } else {
      console.error('Failed to parse initial config or sourceFile. Please check the file.')
      lastAcknowledgedConfigState = { screens: [] } 
    }
  } catch (err) {
    console.error('Error during initial config parse:', err)
    lastAcknowledgedConfigState = { screens: [] }
  }

  if (command === 'add' || command === 'delete') {
    const screenArgs = args.slice(1); // Get all screen names after 'add' or 'delete'
    if (screenArgs.length === 0) {
      console.error(`Please provide at least one screen name for the '${command}' command.`);
      process.exit(1);
    }
    const fullScreenNames = screenArgs.map(nameArg => 
        (nameArg.includes('/') || nameArg.startsWith('(')) 
            ? nameArg 
            : `${nameArg}/index`
    );
    await handleDirectCliCommands(command, fullScreenNames);

    // Re-validate and update state after CLI command
    const postCliConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (postCliConfig?.screens && postCliConfig.sourceFile) {
      console.log("Running post-CLI command consistency validation...");
      const validationResult = await validateProjectConsistency(postCliConfig.screens, postCliConfig.sourceFile, true); 
      if (validationResult.astModified || validationResult.fixesApplied) {
        const finalConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
        if (finalConfig?.screens) lastAcknowledgedConfigState = { screens: finalConfig.screens };
      } else {
          lastAcknowledgedConfigState = { screens: postCliConfig.screens };
      }
    } else console.warn("Could not get latest config for post-CLI validation.");

  } else if (command) {
    console.log(`Unknown command: ${command}. Available commands: add, delete. Or run without commands for watcher mode.`)
    process.exit(1)
  } else {
    // Watcher Setup
    console.log(`Watching for changes in ${NAVIGATION_CONFIG_PATH}...`)
    const watcher = chokidar.watch(NAVIGATION_CONFIG_PATH, {
      persistent: true,
      ignoreInitial: true, 
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }, 
    })

    watcher.on('change', (filePath) => onConfigFileChanged(filePath))
    watcher.on('error', (error) => console.error(`Watcher error: ${error}`))

    if (initialConfigResult) {
      console.log(`Initial flags for watcher: isAutoSaveOn=${initialConfigResult.isAutoSaveOn}, isEditing=${initialConfigResult.isEditing}`)
      const hasPendingCommands = initialConfigResult.commandsToExecute &&
                                (initialConfigResult.commandsToExecute.add?.length > 0 || initialConfigResult.commandsToExecute.delete?.length > 0);

      if (initialConfigResult.isAutoSaveOn && initialConfigResult.isEditing && !hasPendingCommands) {
        editingModeActive = true
        console.log('Started in editing mode (watcher mode, no pending commands).')
      } else if (hasPendingCommands) {
        console.log("Pending commands detected on startup. Triggering initial processing for watcher.");
        onConfigFileChanged(NAVIGATION_CONFIG_PATH); 
      } else {
        console.log("Watcher started. Not in editing mode and no pending commands on startup.");
      }
    }
    console.log('CLI tool started in watcher mode. Press Ctrl+C to exit.')
  }
}

async function handleDirectCliCommands(command, configScreenNames) { 
  console.log(`Executing direct CLI command: ${command} for screen(s): ${configScreenNames.join(', ')}`)

  try {
    let currentParsedConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
    if (!currentParsedConfig || !currentParsedConfig.screens) {
      console.error('Could not parse layout.tsx for CLI command.');
      return;
    }

    const astModificationsForLayout = { screensToAdd: [], screenNamesToDelete: [], importsToAdd: [], importsToRemove: [] };
    const fileGenerationDetails = []; // Store details needed for file generation
    let astShouldChange = false;

    if (command === 'add') {
        if (configScreenNames.length === 0) {
            console.log("No screens specified to add.");
            return;
        }

        const { parentNavigatorChoice } = await inquirer.default.prompt([
            {
                type: 'list',
                name: 'parentNavigatorChoice',
                message: `Add ${configScreenNames.length > 1 ? 'these screens' : `screen '${configScreenNames[0]}'`} to which navigator?`,
                choices: [
                    { name: 'Tabs Navigator (as new tabs)', value: { name: '(tabs)', type: 'tabs' } },
                    { name: 'Drawer Navigator (as new drawer items)', value: { name: '(drawer)', type: 'drawer' } }
                ]
            }
        ]);
        const parentNameFromPrompt = parentNavigatorChoice.name;
        const parentTypeFromPrompt = parentNavigatorChoice.type;

        // Ask for global default confirmation
        const { useDefaultsForAll } = await inquirer.default.prompt([{
            type: 'confirm',
            name: 'useDefaultsForAll',
            message: `Use default configurations for all ${configScreenNames.length} screen(s)? (You can customize each later if you choose 'No')`,
            default: true
        }]);

        for (const configScreenName of configScreenNames) {
            const routeSegmentName = getRouteSegmentName(configScreenName);
            const featureFolderName = getRouteSegmentName(configScreenName); // For #features/... path
            const cleanFeatureName = getCleanFeatureName(configScreenName);

            let componentName = capitalizeFirstLetter(cleanFeatureName) + 'Screen';
            let title = capitalizeFirstLetter(cleanFeatureName);
            let icon = cleanFeatureName.toLowerCase();
            let label = capitalizeFirstLetter(cleanFeatureName);
            const parentRouteSegment = getRouteSegmentName(parentNameFromPrompt);
            let href = `/${parentRouteSegment === 'Root' ? '' : parentRouteSegment + '/'}${routeSegmentName}`;
            
            let finalConfigScreenName = configScreenName; // Will be like "name/index"

            if (!useDefaultsForAll) {
                const { confirmDefaultCurrent } = await inquirer.default.prompt([{ 
                    type: 'confirm', 
                    name: 'confirmDefaultCurrent', 
                    message: `Use default config for '${configScreenName}'? (Comp: ${componentName}, Title: ${title})`, 
                    default: true 
                }]);

                if (!confirmDefaultCurrent) {
                    const answers = await inquirer.default.prompt([
                        { type: 'input', name: 'routeSegment', message: `Route segment for '${configScreenName}':`, default: routeSegmentName, validate: input => /^[a-z0-9_()]+$/.test(input) || 'Invalid segment name.' },
                        { type: 'input', name: 'componentName', message: 'ComponentName:', default: componentName, validate: input => /^[A-Z][a-zA-Z0-9_]*Screen$/.test(input) || 'Invalid component name.' },
                        { type: 'input', name: 'title', message: 'Screen title:', default: title },
                        { type: 'input', name: 'href', message: 'Screen href (full path e.g. /drawer/settings):', default: href },
                    ]);
                    
                    finalConfigScreenName = `${answers.routeSegment}/index`;
                    componentName = answers.componentName; 
                    title = answers.title; 
                    href = answers.href;
                    const currentFeatureFolderName = answers.routeSegment; // feature folder name is based on the segment

                    if (parentTypeFromPrompt === 'tabs') {
                        const tabAnswers = await inquirer.default.prompt([{ type: 'input', name: 'icon', message: 'tabBarIconName:', default: icon }]);
                        icon = tabAnswers.icon;
                    } else { 
                        const drawerAnswers = await inquirer.default.prompt([{ type: 'input', name: 'label', message: 'drawerLabel:', default: label }]);
                        label = drawerAnswers.label;
                    }
                    astModificationsForLayout.screensToAdd.push({ name: finalConfigScreenName, componentName, title, icon, label, href, parentName: parentNameFromPrompt, parentType: parentTypeFromPrompt });
                    astModificationsForLayout.importsToAdd.push({ componentName, screenName: currentFeatureFolderName }); 
                    fileGenerationDetails.push({ configScreenName: finalConfigScreenName, componentName, parent: parentNavigatorChoice, title });
                } else { // Use defaults for this specific screen
                    astModificationsForLayout.screensToAdd.push({ name: configScreenName, componentName, title, icon, label, href, parentName: parentNameFromPrompt, parentType: parentTypeFromPrompt });
                    astModificationsForLayout.importsToAdd.push({ componentName, screenName: featureFolderName });
                    fileGenerationDetails.push({ configScreenName, componentName, parent: parentNavigatorChoice, title });
                }
            } else { // Use defaults for all
                astModificationsForLayout.screensToAdd.push({ name: configScreenName, componentName, title, icon, label, href, parentName: parentNameFromPrompt, parentType: parentTypeFromPrompt });
                astModificationsForLayout.importsToAdd.push({ componentName, screenName: featureFolderName });
                fileGenerationDetails.push({ configScreenName, componentName, parent: parentNavigatorChoice, title });
            }
        }
        if (astModificationsForLayout.screensToAdd.length > 0) astShouldChange = true;

    } else if (command === 'delete') {
        let parentChoiceForDelete;
        if (configScreenNames.length > 1) {
            const { parent } = await inquirer.default.prompt([
                { type: 'list', name: 'parent', message: `Delete these screens from which navigator?`,
                  choices: [ 
                      { name: 'Drawer (parent is (drawer))', value: { name: '(drawer)', type: 'drawer' } },
                      { name: 'Tabs (parent is (tabs))', value: { name: '(tabs)', type: 'tabs' } }
                  ]
                }
            ]);
            parentChoiceForDelete = parent;
        }

        for (const configScreenName of configScreenNames) {
            let parentToDeleteFrom = parentChoiceForDelete;
            if (!parentToDeleteFrom) { 
                 const { parent } = await inquirer.default.prompt([
                    { type: 'list', name: 'parent', message: `For screen '${configScreenName}', which navigator should it be deleted from?`,
                      choices: [ 
                          { name: 'Drawer (parent is (drawer))', value: { name: '(drawer)', type: 'drawer' } },
                          { name: 'Tabs (parent is (tabs))', value: { name: '(tabs)', type: 'tabs' } }
                      ]
                    }
                ]);
                parentToDeleteFrom = parent;
            }
            const parentNameFromPrompt = parentToDeleteFrom.name;

            const screenToDelete = currentParsedConfig.screens.find(s => s.name === configScreenName && s.parent.name === parentNameFromPrompt);
            if (!screenToDelete) {
                console.warn(`Screen '${configScreenName}' not found in parent '${parentNameFromPrompt}'. Skipping AST delete.`);
                continue;
            }
            if (configScreenNames.length === 1) { 
                const { confirmDelete } = await inquirer.default.prompt([{ type: 'confirm', name: 'confirmDelete', message: `Confirm removal of screen '${configScreenName}' from '${parentNameFromPrompt}' in layout.tsx?`, default: true }]);
                if (!confirmDelete) { console.log(`Skipped AST removal of '${configScreenName}'.`); continue; }
            }
            astModificationsForLayout.screenNamesToDelete.push({ name: configScreenName, parentName: parentNameFromPrompt });
            if (screenToDelete.componentName) astModificationsForLayout.importsToRemove.push({ componentName: screenToDelete.componentName });
            astShouldChange = true; 
        }
        if (configScreenNames.length > 1 && astModificationsForLayout.screenNamesToDelete.length > 0) {
            const { confirmBatchDelete } = await inquirer.default.prompt([{
                type: 'confirm',
                name: 'confirmBatchDelete',
                message: `Confirm removal of ${astModificationsForLayout.screenNamesToDelete.length} screen(s) from layout.tsx?`,
                default: true
            }]);
            if (!confirmBatchDelete) {
                console.log("Batch delete cancelled by user.");
                astModificationsForLayout.screenNamesToDelete = []; 
                astModificationsForLayout.importsToRemove = [];
                astShouldChange = false;
            }
        }
    }

    if (astShouldChange) {
      await modifyLayoutFileWithAst(astModificationsForLayout);
      console.log(`layout.tsx AST updated by CLI command: ${command}.`);
      
      const allGeneratedOrModifiedFiles = new Set([NAVIGATION_CONFIG_PATH]);

      if (command === 'add') {
        console.log(`\nGenerating files for ${fileGenerationDetails.length} added screen(s)...`);
        for (const task of fileGenerationDetails) {
          console.log(`\nGenerating files for: ${task.configScreenName}`);
          const featureP = await generateFeatureScreen(task.configScreenName, task.componentName, task.title, false, true);
          if(featureP) allGeneratedOrModifiedFiles.add(featureP);
          const expoP = await generateExpoFile(task.configScreenName, task.componentName, task.parent, false, true);
          if(expoP) allGeneratedOrModifiedFiles.add(expoP);
          const webP = await generateWebFile(task.configScreenName, task.componentName, task.parent, false, true);
          if(webP) allGeneratedOrModifiedFiles.add(webP);
        }
      } else if (command === 'delete') {
        console.log(`\nDeleting files for ${astModificationsForLayout.screenNamesToDelete.length} removed screen(s)...`);
        for (const screenToDelete of astModificationsForLayout.screenNamesToDelete) {
            const parentObject = currentParsedConfig.screens.find(s => s.name === screenToDelete.parentName && s.type !== 'screen') || 
                                 currentParsedConfig.screens.find(s => getRouteSegmentName(s.name) === getRouteSegmentName(screenToDelete.parentName) && s.type !== 'screen') ||
                                 { name: screenToDelete.parentName, type: 'unknown' }; 
            const deletedPaths = await deleteScreenFiles(screenToDelete.name, parentObject);
            deletedPaths.forEach(p => allGeneratedOrModifiedFiles.add(p));
        }
      }
      
      const newConfig = await parseNavigationConfig(NAVIGATION_CONFIG_PATH);
      if (newConfig && newConfig.screens) {
          lastAcknowledgedConfigState = { screens: newConfig.screens };
          console.log("Snapshot `lastAcknowledgedConfigState` updated after CLI operations.");
      }
    } else {
      console.log('No AST changes made or confirmed by CLI command.');
    }

  } catch (error) {
    console.error(`Error during 'handleDirectCliCommands' for ${command}:`, error)
  }
}


main().catch((err) => {
  console.error('Unhandled error in main execution:', err)
  process.exit(1)
})