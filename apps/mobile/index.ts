import "react-native-gesture-handler";
import { createElement } from "react";
import { registerRootComponent } from "expo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import App from "./App";

function Root() {
  return createElement(
    GestureHandlerRootView,
    { style: { flex: 1 } },
    createElement(App),
  );
}

registerRootComponent(Root);
