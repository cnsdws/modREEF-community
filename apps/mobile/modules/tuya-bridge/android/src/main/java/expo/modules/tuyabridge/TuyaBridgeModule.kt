package expo.modules.tuyabridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TuyaBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TuyaBridge")

    Function("getStatus") {
      mapOf(
        "sdkLoaded" to false,
        "platform" to "android",
        "loggedIn" to false,
      )
    }
  }
}
