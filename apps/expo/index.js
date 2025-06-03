// apps/expo/index.js
// apps/expo/index.js
// import { registerRootComponent } from 'expo'

// // import App from './App'
// import RootStackLayout from './app/_layout'

// // registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// // It also ensures that whether you load the app in Expo Go or in a native build,
// // the environment is set up appropriately
// registerRootComponent(RootStackLayout)
// import 'expo-router/entry';

import { registerRootComponent } from 'expo'
import { ExpoRoot } from 'expo-router'
  
// Must be exported or Fast Refresh won't update the context
export function App() {
  const ctx = require.context('./app')
  return <ExpoRoot context={ctx} />
}

registerRootComponent(App)



// import 'expo-router/entry';

// import 'setimmediate'

// if (!global?.setImmediate) {
//   global.setImmediate = setTimeout
// }

// import 'expo-router/entry'
