import type {
  CapabilityKind,
  DeviceDriver,
  DeviceProtocol,
} from "@modreef/hal";

export type DeviceSupportLevel =
  | "experimental"
  | "community-tested"
  | "verified";

export type DeviceClass =
  | "outlet"
  | "power-strip"
  | "return-pump"
  | "wavemaker"
  | "doser"
  | "water-quality"
  | "sensor"
  | "other";

export type OnboardingMethod =
  | "lan-discovery"
  | "bluetooth-control"
  | "bluetooth-wifi"
  | "matter"
  | "manual";

export interface DeviceMatchInput {
  manufacturer?: string;
  model?: string;
  productId?: string;
  advertisedName?: string;
  serviceUuids?: readonly string[];
  protocols?: readonly string[];
}

export interface DeviceMatch {
  confidence: number;
  reason: string;
}

export interface DeviceEquipmentTemplate {
  channelId: string;
  defaultName: string;
  role: string;
  lockedRole?: boolean;
}

export interface DeviceIntegrationManifest {
  schemaVersion: 1;
  id: string;
  displayName: string;
  manufacturer: string;
  models: readonly string[];
  deviceClass: DeviceClass;
  support: DeviceSupportLevel;
  protocols: readonly DeviceProtocol[];
  capabilityKinds: readonly CapabilityKind[];
  onboarding: {
    methods: readonly OnboardingMethod[];
    requiresNativeMobileModule: boolean;
  };
  equipment: readonly DeviceEquipmentTemplate[];
  documentation?: string;
  match(input: DeviceMatchInput): DeviceMatch | null;
  validateRegistration(input: unknown): void;
  createDriver(input: unknown, services?: Readonly<Record<string, unknown>>): DeviceDriver;
}

export interface MatchedDeviceIntegration {
  integration: DeviceIntegrationManifest;
  match: DeviceMatch;
}

export class DeviceIntegrationRegistry {
  private readonly integrations = new Map<string, DeviceIntegrationManifest>();

  constructor(integrations: readonly DeviceIntegrationManifest[] = []) {
    for (const integration of integrations) this.register(integration);
  }

  register(integration: DeviceIntegrationManifest): this {
    assertManifest(integration);
    if (this.integrations.has(integration.id)) {
      throw new Error(`Device integration already registered: ${integration.id}`);
    }
    this.integrations.set(integration.id, integration);
    return this;
  }

  list(): DeviceIntegrationManifest[] {
    return [...this.integrations.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName)
    );
  }

  get(id: string): DeviceIntegrationManifest {
    const integration = this.integrations.get(id);
    if (!integration) throw new Error(`Device integration not found: ${id}`);
    return integration;
  }

  identify(input: DeviceMatchInput): MatchedDeviceIntegration[] {
    return this.list()
      .map((integration) => ({ integration, match: integration.match(input) }))
      .filter((item): item is MatchedDeviceIntegration => item.match !== null)
      .sort((left, right) => right.match.confidence - left.match.confidence);
  }

  createDriver(
    integrationId: string,
    registration: unknown,
    services?: Readonly<Record<string, unknown>>,
  ): DeviceDriver {
    const integration = this.get(integrationId);
    integration.validateRegistration(registration);
    return integration.createDriver(registration, services);
  }
}

export function defineDeviceIntegration(
  manifest: DeviceIntegrationManifest,
): DeviceIntegrationManifest {
  assertManifest(manifest);
  return manifest;
}

function assertManifest(manifest: DeviceIntegrationManifest): void {
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported device integration schema");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.id)) {
    throw new Error(`Invalid device integration id: ${manifest.id}`);
  }
  if (!manifest.displayName.trim()) throw new Error("Device integration display name is required");
  if (!manifest.manufacturer.trim()) throw new Error("Device integration manufacturer is required");
  if (manifest.models.length === 0) throw new Error("Device integration must declare a model");
  if (new Set(manifest.capabilityKinds).size !== manifest.capabilityKinds.length) {
    throw new Error(`Device integration has duplicate capabilities: ${manifest.id}`);
  }
}
