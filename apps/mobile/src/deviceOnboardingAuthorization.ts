export interface DeviceAdministrationController {
  id: string;
  name: string;
}

export function soleControllerForDeviceAdministration<
  T extends DeviceAdministrationController,
>(
  controllers: T[],
  selectedControllerId: string | null,
): T | undefined {
  if (controllers.length !== 1) return undefined;
  const controller = controllers[0];
  return controller?.id === selectedControllerId ? undefined : controller;
}

export async function prepareDeviceOnboarding<
  T extends DeviceAdministrationController,
>(
  controller: T | undefined,
  selectController: (controller: T) => Promise<boolean>,
): Promise<void> {
  if (!controller) {
    throw new Error("Choose a Reef Controller before adding a device.");
  }

  if (!(await selectController(controller))) {
    throw new Error(`Could not authorize ${controller.name} for device setup.`);
  }
}
