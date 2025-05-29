// __tests__/App.test.tsx
/**
 * @format
 */

import "react-native";
import { it } from "@jest/globals";
import renderer from "react-test-renderer";

import App from "./web/app/App.tsx;

// Note: import explicitly to use the types shipped with jest.

// Note: test renderer must be required after react-native.

it("renders correctly", () => {
  renderer.create(<App />);
});
