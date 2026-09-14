#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/modreef-imager-manifest.XXXXXX")"
trap 'rm -rf -- "${TEST_DIRECTORY}"' EXIT

printf 'test community image\n' > "${TEST_DIRECTORY}/test.img"
xz -k "${TEST_DIRECTORY}/test.img"

node "${REPOSITORY_ROOT}/scripts/generate-imager-manifest.mjs" \
  "${TEST_DIRECTORY}/test.img.xz" - \
  "${TEST_DIRECTORY}/modreef-controller.rpi-imager-manifest" \
  2026-08-27

node - "${TEST_DIRECTORY}" <<'NODE'
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const directory = process.argv[2];
const image = readFileSync(`${directory}/test.img`);
const compressed = readFileSync(`${directory}/test.img.xz`);
const manifest = JSON.parse(readFileSync(
  `${directory}/modreef-controller.rpi-imager-manifest`,
  "utf8",
));
const entry = manifest.os_list[0];
if (manifest.imager.default_os !== entry.name) throw new Error("Wrong default OS");
const deviceTags = manifest.imager.devices.flatMap((device) => device.tags);
if (manifest.imager.devices.some((device) => device.default)) {
  throw new Error("Imager must ask the user to select their Raspberry Pi model");
}
if (!deviceTags.includes("pi4-64bit") || !deviceTags.includes("pi5-64bit")) {
  throw new Error("Pi 4 and Pi 5 must be available in the device picker");
}
if (entry.init_format !== "cloudinit-rpi") throw new Error("Wrong init_format");
if (!entry.icon) throw new Error("Missing schema-required OS icon");
if (!entry.devices.includes("pi4-64bit") || !entry.devices.includes("pi5-64bit")) {
  throw new Error("Wrong device support");
}
if (entry.url !== pathToFileURL(`${directory}/test.img.xz`).toString()) {
  throw new Error("Wrong local image URL");
}
if (entry.extract_size !== image.length) throw new Error("Wrong extracted size");
if (entry.image_download_size !== compressed.length) throw new Error("Wrong download size");
if (entry.extract_sha256 !== createHash("sha256").update(image).digest("hex")) {
  throw new Error("Wrong extracted checksum");
}
if (entry.image_download_sha256 !== createHash("sha256").update(compressed).digest("hex")) {
  throw new Error("Wrong download checksum");
}
NODE

grep -Fq "ENABLE_CLOUD_INIT='1'" "${REPOSITORY_ROOT}/scripts/build-community-image.sh"
grep -Fq 'users: []' \
  "${REPOSITORY_ROOT}/image/pi-gen/stage-modreef/00-install-modreef/00-run.sh"
grep -Fq 'ssh_pwauth: false' \
  "${REPOSITORY_ROOT}/image/pi-gen/stage-modreef/00-install-modreef/00-run.sh"
grep -Fq "export MODREEF_SOURCE_COMMIT='\${SOURCE_COMMIT}'" \
  "${REPOSITORY_ROOT}/scripts/build-community-image.sh"
grep -Fq 'The community image source commit is missing or invalid.' \
  "${REPOSITORY_ROOT}/image/pi-gen/stage-modreef/00-install-modreef/00-run.sh"
grep -Fq '"softwareVersion": "${SOFTWARE_VERSION}"' \
  "${REPOSITORY_ROOT}/image/pi-gen/stage-modreef/00-install-modreef/00-run.sh"
echo "Raspberry Pi Imager manifest generation passed."
