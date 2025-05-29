// App.tsx      
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { DrawerLayout } from './DrawerLayout';
import 'react-native-gesture-handler';

// No more divs! NavigationContainer is the top-level component.
function App() {
  return (
    <NavigationContainer>
      <DrawerLayout />
    </NavigationContainer>
  );
}

export default App;

// // import logo from './logo.svg';
// // import './App.css';
// import { NavigationContainer } from "@react-navigation/native";
// import { createNativeStackNavigator } from "@react-navigation/native-stack";
// import { DrawerLayout } from "./DrawerLayout";
// import { AboutPage } from "./About";
// import "react-native-gesture-handler";

// const Stack = createNativeStackNavigator();

// function App() {
//   return (
//     <div className="App">
//       <header className="App-header">
//         <NavigationContainer>
//           <Stack.Navigator initialRouteName="Main">
//             <Stack.Screen name="Main" component={DrawerLayout} />
//             <Stack.Screen name="About" component={AboutPage} />
//           </Stack.Navigator>
//         </NavigationContainer>
//       </header>
//     </div>
//   );
// }

// export default App;
