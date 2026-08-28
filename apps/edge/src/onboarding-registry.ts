export interface EquipmentRegistration {
  deviceId: string;
  displayName: string;
  transport: "bluetooth-le";
  manufacturer?: string;
  model?: string;
  networkAddress?: string;
  commissioningId?: string;
}

export interface RegisteredEquipment
  extends EquipmentRegistration {
  registeredAt: string;
}

interface StateStore {
  loadState<T>(key: string): T | undefined;
  saveState<T>(key: string, value: T): void;
}

const registryKey = "onboarding.equipment";

export class OnboardingRegistry {
  constructor(
    private readonly store: StateStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): RegisteredEquipment[] {
    return this.store.loadState<RegisteredEquipment[]>(
      registryKey,
    ) ?? [];
  }

  register(
    registration: EquipmentRegistration,
  ): RegisteredEquipment {
    const record: RegisteredEquipment = {
      ...registration,
      registeredAt: this.now().toISOString(),
    };

    const records = this.list();
    const existingIndex = records.findIndex(
      (item) => item.deviceId === registration.deviceId,
    );

    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.push(record);
    }

    this.store.saveState(registryKey, records);
    return record;
  }

  remove(deviceId: string): RegisteredEquipment | null {
    const records = this.list();
    const removed = records.find((item) => item.deviceId === deviceId) ?? null;
    if (!removed) return null;

    this.store.saveState(
      registryKey,
      records.filter((item) => item.deviceId !== deviceId),
    );
    return removed;
  }
}
