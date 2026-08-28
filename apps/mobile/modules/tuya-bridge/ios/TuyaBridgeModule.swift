import ExpoModulesCore
import ThingSmartBLEKit
import ThingSmartHomeKit

private final class TuyaBleDelegateProxy:
  NSObject,
  ThingSmartBLEManagerDelegate,
  ThingSmartBLEWifiActivatorDelegate
{
  var onDiscovery: ((ThingBLEAdvModel) -> Void)?
  var onResult: ((ThingSmartDeviceModel?, Error?) -> Void)?

  func didDiscoveryDevice(
    withDeviceInfo deviceInfo: ThingBLEAdvModel
  ) {
    onDiscovery?(deviceInfo)
  }

  func bleWifiActivator(
    _ activator: ThingSmartBLEWifiActivator,
    didReceiveBLEWifiConfigDevice deviceModel:
      ThingSmartDeviceModel?,
    error: Error?
  ) {
    onResult?(deviceModel, error)
  }
}

public class TuyaBridgeModule: Module {
  private let homeManager = ThingSmartHomeManager()
  private let bleManager = ThingSmartBLEManager.sharedInstance()
  private let bleWifiActivator =
    ThingSmartBLEWifiActivator.sharedInstance()
  private let bleDelegate = TuyaBleDelegateProxy()
  private var pairingPromise: Promise?
  private var pairingStarted = false
  private var pairingFallback: DispatchWorkItem?
  private var discoveredCandidates:
    [String: [String: Any]] = [:]

  public func definition() -> ModuleDefinition {
    Name("TuyaBridge")

    Function("getStatus") { () -> [String: Any] in
      _ = ThingSmartSDK.sharedInstance()

      return [
        "sdkLoaded": true,
        "platform": "ios",
        "loggedIn": ThingSmartUser.sharedInstance().isLogin,
      ]
    }

    AsyncFunction("getHomes") { (promise: Promise) in
      self.homeManager.getHomeList(
        success: { homes in
          let result = (homes ?? []).map { home in
            [
              "id": String(home.homeId),
              "name": home.name ?? "Unnamed home",
              "geoName": home.geoName ?? "",
            ]
          }

          promise.resolve(result)
        },
        failure: { error in
          promise.reject(
            "TUYA_GET_HOMES_FAILED",
            error?.localizedDescription ?? "Could not load Tuya homes"
          )
        }
      )
    }

    AsyncFunction("createHome") {
      (name: String, promise: Promise) in
      self.homeManager.addHome(
        withName: name,
        geoName: "",
        rooms: ["Aquarium"],
        latitude: 0,
        longitude: 0,
        success: { homeId in
          promise.resolve([
            "id": String(homeId),
            "name": name,
            "geoName": "",
          ])
        },
        failure: { error in
          promise.reject(
            "TUYA_CREATE_HOME_FAILED",
            error?.localizedDescription ?? "Could not create Tuya home"
          )
        }
      )
    }

    AsyncFunction("getHomeDevices") {
      (homeId: String, promise: Promise) in
      guard let numericHomeId = Int64(homeId) else {
        promise.reject("TUYA_INVALID_HOME_ID", "The Tuya Home ID is invalid")
        return
      }

      guard let home = ThingSmartHome(homeId: numericHomeId) else {
        promise.reject("TUYA_HOME_NOT_FOUND", "The Tuya Home could not be opened")
        return
      }
      home.getDataWithSuccess({ _ in
        var devices: [[String: Any]] = []
        for device in home.deviceList {
          devices.append(self.serializeHomeDevice(device))
        }
        promise.resolve(devices)
      }, failure: { error in
        promise.reject(
          "TUYA_GET_HOME_DEVICES_FAILED",
          error?.localizedDescription ?? "Could not load Tuya devices"
        )
      })
    }

    AsyncFunction("refreshDevice") {
      (deviceId: String, promise: Promise) in
      ThingSmartDevice.syncDeviceInfo(
        withDevId: deviceId,
        success: { device in
          promise.resolve(self.serializeHomeDevice(device))
        },
        failure: { error in
          promise.reject(
            "TUYA_REFRESH_DEVICE_FAILED",
            error?.localizedDescription ?? "Could not refresh the Tuya device"
          )
        }
      )
    }

    AsyncFunction("removeDevice") {
      (deviceId: String, promise: Promise) in
      guard let device = ThingSmartDevice(deviceId: deviceId) else {
        promise.reject("TUYA_DEVICE_NOT_FOUND", "The Tuya device is no longer owned")
        return
      }
      device.remove({
        promise.resolve(["removed": true])
      }, failure: { error in
        promise.reject(
          "TUYA_REMOVE_DEVICE_FAILED",
          error?.localizedDescription ?? "Could not remove the Tuya device"
        )
      })
    }

    Function("startBleWifiScan") {
      self.discoveredCandidates = [:]

      self.bleDelegate.onDiscovery = {
        [weak self] deviceInfo in
        guard
          !deviceInfo.uuid.isEmpty,
          !deviceInfo.productId.isEmpty
        else {
          return
        }

        self?.discoveredCandidates[deviceInfo.uuid] = [
          "id": deviceInfo.uuid,
          "displayName": "Nearby Tuya device",
          "productId": deviceInfo.productId,
          "bleType": Int(deviceInfo.bleType.rawValue),
          "active": deviceInfo.isActive,
        ]
      }

      self.bleManager.delegate = self.bleDelegate
      self.bleManager.startListening(
        with: .allDevice,
        cacheStatu: true
      )
    }

    Function("finishBleWifiScan") {
      () -> [[String: Any]] in
      // Stop active discovery but retain Tuya's candidate cache. Wi-Fi
      // activation needs that cached BLE device after the user selects it.
      self.bleManager.stopListening(false)
      self.bleManager.delegate = nil
      self.bleDelegate.onDiscovery = nil

      return Array(self.discoveredCandidates.values)
    }

    Function("getBleWifiScanCandidates") {
      () -> [[String: Any]] in
      return Array(self.discoveredCandidates.values)
    }

    Function("stopBleWifiScan") {
      self.bleManager.stopListening(true)
      self.bleManager.delegate = nil
      self.bleDelegate.onDiscovery = nil
      self.discoveredCandidates = [:]
    }

    Function("resetPairingSession") {
      if self.pairingPromise != nil {
        self.failPairing(
          code: "TUYA_PAIRING_CANCELLED",
          message: "The previous Tuya pairing attempt was cancelled"
        )
      } else {
        self.clearPairing()
      }
    }

    AsyncFunction("pairWifiDevice") {
      (
        homeId: String,
        uuid: String,
        productId: String,
        ssid: String,
        password: String,
        promise: Promise
      ) in
      guard self.pairingPromise == nil else {
        promise.reject(
          "TUYA_PAIRING_IN_PROGRESS",
          "A Tuya pairing session is already running"
        )
        return
      }

      guard let numericHomeId = Int64(homeId) else {
        promise.reject(
          "TUYA_INVALID_HOME_ID",
          "The Tuya Home ID is invalid"
        )
        return
      }

      guard !uuid.isEmpty, !productId.isEmpty else {
        promise.reject(
          "TUYA_INVALID_BLE_DEVICE",
          "The selected Tuya device is invalid"
        )
        return
      }

      self.pairingPromise = promise
      self.pairingStarted = false

      self.bleDelegate.onResult = {
        [weak self] deviceModel, error in
        self?.handlePairingResult(
          deviceModel: deviceModel,
          error: error
        )
      }

      self.bleWifiActivator.bleWifiDelegate =
        self.bleDelegate

      self.startBleWifiPairing(
        uuid: uuid,
        productId: productId,
        homeId: numericHomeId,
        ssid: ssid,
        password: password
      )
    }

    AsyncFunction("provisionWifiDevice") {
      (
        homeId: String,
        advertisedUuid: String,
        productId: String,
        ssid: String,
        password: String,
        promise: Promise
      ) in
      guard let numericHomeId = Int64(homeId) else {
        promise.reject("TUYA_INVALID_HOME_ID", "The Tuya Home ID is invalid")
        return
      }
      guard !advertisedUuid.isEmpty, !productId.isEmpty else {
        promise.reject(
          "TUYA_INVALID_BLE_DEVICE",
          "The selected Tuya device is invalid"
        )
        return
      }

      // A provisioning request is a complete transaction. Never inherit
      // delegates, promises, or activator state from a previous attempt.
      if self.pairingPromise != nil {
        self.failPairing(
          code: "TUYA_PAIRING_REPLACED",
          message: "The previous Tuya pairing attempt was replaced"
        )
      } else {
        self.clearPairing()
      }

      self.pairingPromise = promise
      self.pairingStarted = false
      self.bleDelegate.onResult = { [weak self] deviceModel, error in
        self?.handlePairingResult(deviceModel: deviceModel, error: error)
      }
      self.bleWifiActivator.bleWifiDelegate = self.bleDelegate

      let beginPairing: (String) -> Void = { [weak self] uuid in
        guard let self, self.pairingPromise != nil else { return }
        self.startBleWifiPairing(
          uuid: uuid,
          productId: productId,
          homeId: numericHomeId,
          ssid: ssid,
          password: password
        )
      }

      self.bleDelegate.onDiscovery = { deviceInfo in
        guard deviceInfo.productId == productId else { return }
        beginPairing(deviceInfo.uuid)
      }
      self.bleManager.delegate = self.bleDelegate
      self.bleManager.startListening(with: .allDevice, cacheStatu: true)

      // Some FD50 firmware is visible to CoreBluetooth but omitted from the
      // public Tuya discovery callback. In that case use the advertisement
      // identity supplied by the caller after giving the SDK time to cache it.
      let fallback = DispatchWorkItem {
        beginPairing(advertisedUuid)
      }
      self.pairingFallback = fallback
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: fallback)
    }

    AsyncFunction("registerAnonymous") {
      (countryCode: String, promise: Promise) in
      ThingSmartUser.sharedInstance().registerAnonymous(
        withCountryCode: countryCode,
        success: {
          promise.resolve([
            "loggedIn": ThingSmartUser.sharedInstance().isLogin,
          ])
        },
        failure: { error in
          promise.reject(
            "TUYA_ANONYMOUS_REGISTRATION_FAILED",
            error?.localizedDescription ?? "Anonymous registration failed"
          )
        }
      )
    }
  }

  private func startBleWifiPairing(
    uuid: String,
    productId: String,
    homeId: Int64,
    ssid: String,
    password: String
  ) {
    guard !pairingStarted else {
      return
    }

    pairingStarted = true
    pairingFallback?.cancel()
    pairingFallback = nil
    bleManager.stopListening(false)

    bleWifiActivator.startConfigBLEWifiDevice(
      withUUID: uuid,
      homeId: homeId,
      productId: productId,
      ssid: ssid,
      password: password,
      timeout: 120,
      success: { () -> Void in },
      failure: { [weak self] () -> Void in
        self?.failPairing(
          code: "TUYA_BLE_WIFI_PAIRING_FAILED",
          message:
            "Tuya BLE+Wi-Fi pairing failed to start"
        )
      }
    )
  }

  private func serializeHomeDevice(
    _ device: ThingSmartDeviceModel
  ) -> [String: Any] {
    let id = device.devId ?? ""
    let name = device.name ?? "Tuya device"
    let productId = device.productId ?? ""
    let localKey = device.localKey ?? ""
    let networkAddress = device.ip ?? ""
    let dps = device.dps ?? [:]
    return [
      "id": id,
      "name": name,
      "productId": productId,
      "localKey": localKey,
      "networkAddress": networkAddress,
      "dps": dps,
      "capabilities": device.schemaArray.flatMap { schema in
        [schema.dpId, schema.code, schema.name].compactMap { $0 }
      },
    ]
  }

  private func handlePairingResult(
    deviceModel: ThingSmartDeviceModel?,
    error: Error?
  ) {
    if let error {
      let nsError = error as NSError
      failPairing(
        code: "TUYA_PAIRING_FAILED",
        message:
          "Tuya pairing failed " +
          "(\(nsError.domain) \(nsError.code)): " +
          nsError.localizedDescription
      )
      return
    }

    guard let deviceModel else {
      return
    }

    let promise = pairingPromise
    clearPairing()

    promise?.resolve([
      "ok": true,
      "id": deviceModel.devId ?? "",
      "name": deviceModel.name ?? "Tuya device",
      "productId": deviceModel.productId ?? "",
      "localKey": deviceModel.localKey ?? "",
      "networkAddress": deviceModel.ip ?? "",
      "dps": deviceModel.dps ?? [:],
      "capabilities": deviceModel.schemaArray.flatMap { schema in
        [schema.dpId, schema.code, schema.name].compactMap { $0 }
      },
    ])
  }

  private func failPairing(code: String, message: String) {
    let promise = pairingPromise
    clearPairing()
    promise?.resolve([
      "ok": false,
      "code": code,
      "message": message,
    ])
  }

  private func clearPairing() {
    pairingFallback?.cancel()
    pairingFallback = nil
    bleManager.stopListening(true)
    bleManager.delegate = nil
    bleWifiActivator.stopDiscover()
    bleWifiActivator.bleWifiDelegate = nil
    bleDelegate.onDiscovery = nil
    bleDelegate.onResult = nil
    pairingPromise = nil
    pairingStarted = false
  }
}
