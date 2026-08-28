#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [imageArgument, imageUrlArgument, outputArgument, releaseDateArgument] = process.argv.slice(2);

if (!imageArgument || !outputArgument) {
  console.error(
    "Usage: generate-imager-manifest.mjs IMAGE [IMAGE_URL|-] OUTPUT [YYYY-MM-DD]",
  );
  process.exit(1);
}

const imagePath = resolve(imageArgument);
const imageUrl = imageUrlArgument && imageUrlArgument !== "-"
  ? new URL(imageUrlArgument).toString()
  : pathToFileURL(imagePath).toString();
const outputPath = resolve(outputArgument);
const releaseDate = releaseDateArgument ?? new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
  throw new Error(`Invalid release date: ${releaseDate}`);
}

function hashStream(stream) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function inspectImage() {
  const compressed = imagePath.endsWith(".xz");
  const imageDownloadSize = statSync(imagePath).size;
  const imageDownloadSha256 = await hashStream(createReadStream(imagePath));

  if (!compressed) {
    return {
      extractSize: imageDownloadSize,
      extractSha256: imageDownloadSha256,
      imageDownloadSize,
      imageDownloadSha256,
    };
  }

  const xz = spawn("xz", ["--decompress", "--stdout", imagePath], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let extractSize = 0;
  const hash = createHash("sha256");
  xz.stdout.on("data", (chunk) => {
    extractSize += chunk.length;
    hash.update(chunk);
  });
  await new Promise((resolveProcess, reject) => {
    xz.on("error", reject);
    xz.on("close", (code) => {
      if (code === 0) resolveProcess();
      else reject(new Error(`xz exited with status ${code}`));
    });
  });

  return {
    extractSize,
    extractSha256: hash.digest("hex"),
    imageDownloadSize,
    imageDownloadSha256,
  };
}

const image = await inspectImage();
const manifest = {
  imager: {
    latest_version: "2.0.0",
    url: "https://www.raspberrypi.com/software/",
    default_os: "modREEF Community Reef Controller",
    devices: [
      {
        name: "Raspberry Pi 5",
        tags: ["pi5-64bit"],
        icon: "https://downloads.raspberrypi.com/imager/icons/RPi_5.png",
        description: "Raspberry Pi 5, 500 / 500+, and Compute Module 5",
        matching_type: "exclusive",
        capabilities: [],
      },
      {
        name: "Raspberry Pi 4",
        tags: ["pi4-64bit"],
        icon: "https://downloads.raspberrypi.com/imager/icons/RPi_4.png",
        description: "Raspberry Pi 4 Model B, 400, and Compute Module 4 / 4S",
        matching_type: "exclusive",
        capabilities: [],
      },
    ],
  },
  os_list: [
    {
      name: "modREEF Community Reef Controller",
      description: "Open-source modREEF controller for Raspberry Pi 4 and Pi 5",
      icon: "https://downloads.raspberrypi.com/imager/icons/RPi_4.png",
      url: imageUrl,
      extract_size: image.extractSize,
      extract_sha256: image.extractSha256,
      image_download_size: image.imageDownloadSize,
      image_download_sha256: image.imageDownloadSha256,
      release_date: releaseDate,
      init_format: "cloudinit-rpi",
      devices: ["pi5-64bit", "pi4-64bit"],
      capabilities: [],
    },
  ],
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote Raspberry Pi Imager manifest for ${basename(imagePath)} to ${outputPath}`);
