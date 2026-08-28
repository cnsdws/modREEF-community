#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const storeRoot = join(process.cwd(), "node_modules", ".pnpm");
const approvedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MPL-2.0",
  "Public Domain",
  "Python-2.0",
  "Unlicense",
  "(BSD-3-Clause OR GPL-2.0)",
  "(MIT OR Apache-2.0)",
  "(MIT OR CC0-1.0)",
]);

const packageFiles = [];

async function collectPackageFiles(nodeModulesDirectory) {
  let entries;
  try {
    entries = await readdir(nodeModulesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const entryPath = join(nodeModulesDirectory, entry.name);
    if (entry.name.startsWith("@")) {
      await collectPackageFiles(entryPath);
    } else {
      packageFiles.push(join(entryPath, "package.json"));
    }
  }
}

for (const storeEntry of await readdir(storeRoot, { withFileTypes: true })) {
  if (!storeEntry.isDirectory()) continue;
  await collectPackageFiles(join(storeRoot, storeEntry.name, "node_modules"));
}

const packages = new Map();
for (const packageFile of packageFiles) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(packageFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }

  if (!manifest.name || !manifest.version) continue;
  const license = typeof manifest.license === "string"
    ? manifest.license
    : Array.isArray(manifest.licenses)
      ? manifest.licenses.map((entry) => entry.type ?? entry).join(" OR ")
      : "MISSING";
  packages.set(`${manifest.name}@${manifest.version}`, license);
}

const unapproved = [...packages.entries()]
  .filter(([, license]) => !approvedLicenses.has(license))
  .sort(([left], [right]) => left.localeCompare(right));

if (unapproved.length > 0) {
  console.error("Dependencies with unreviewed license metadata:");
  for (const [name, license] of unapproved) {
    console.error(`- ${name}: ${license}`);
  }
  process.exit(1);
}

const counts = new Map();
for (const license of packages.values()) {
  counts.set(license, (counts.get(license) ?? 0) + 1);
}

console.log(`Dependency license metadata passed for ${packages.size} installed packages.`);
for (const [license, count] of [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`- ${license}: ${count}`);
}
