import { NativeModule, registerWebModule } from "expo";

class TuyaBridgeModule extends NativeModule {
  getStatus() {
    return {
      sdkLoaded: false,
      platform: "web",
      loggedIn: false,
    };
  }
}

export default registerWebModule(TuyaBridgeModule, "TuyaBridge");
