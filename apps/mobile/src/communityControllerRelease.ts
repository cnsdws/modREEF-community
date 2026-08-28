export const communityControllerRelease = {
  downloadPageUrl: "https://www.modreef.net/download",
  imageUrl:
    "https://github.com/cnsdws/modREEF-community/releases/latest/download/modreef-controller-community-arm64.img.xz",
  imagerUrl: "https://www.raspberrypi.com/software/",
  imagerMacUrl: "https://downloads.raspberrypi.com/imager/imager_latest.dmg",
  imagerWindowsUrl: "https://downloads.raspberrypi.com/imager/imager_latest.exe",
  manifestUrl:
    "https://github.com/cnsdws/modREEF-community/releases/latest/download/modreef-controller.rpi-imager-manifest",
  sourceUrl: "https://github.com/cnsdws/modREEF-community",
} as const;

export function communityControllerImagerUrl(): string {
  return `rpi-imager://open?repo=${encodeURIComponent(communityControllerRelease.manifestUrl)}`;
}

export function isCommunityDownloadPath(pathname: string): boolean {
  return /^\/download\/?$/i.test(pathname);
}
