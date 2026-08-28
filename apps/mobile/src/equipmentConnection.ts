export function equipmentConnectionLabel(
  channelId: string | undefined,
): string {
  if (!channelId) {
    return "Device-level";
  }

  const outlet = /^outlet-(\d+)$/i.exec(channelId);

  if (outlet?.[1]) {
    return `Outlet ${outlet[1]}`;
  }

  if (channelId.toLowerCase() === "usb") {
    return "USB Power";
  }

  const usbPort = /^usb-(\d+)$/i.exec(channelId);

  if (usbPort?.[1]) {
    return `USB ${usbPort[1]}`;
  }

  return channelId;
}
