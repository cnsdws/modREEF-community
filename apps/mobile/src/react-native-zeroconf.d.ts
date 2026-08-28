declare module "react-native-zeroconf" {
  export default class Zeroconf {
    on(event: "resolved", listener: (service: unknown) => void): this;
    removeListener(event: "resolved", listener: (service: unknown) => void): this;
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners(): void;
  }
}
