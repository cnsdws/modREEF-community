#!/usr/bin/env node

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const slug = process.argv[2]?.trim().toLowerCase();
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  console.error("Usage: pnpm create:device <lowercase-device-slug>");
  process.exit(1);
}

const root = process.cwd();
const packageName = `@modreef/driver-${slug}`;
const packageDirectory = resolve(root, "packages", `driver-${slug}`);
if (existsSync(packageDirectory)) {
  console.error(`Device package already exists: packages/driver-${slug}`);
  process.exit(1);
}

const words = slug.split("-");
const pascal = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
const title = words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
const manifestName = `${words[0]}${words.slice(1).map((word) => word[0].toUpperCase() + word.slice(1)).join("")}Integration`;

const files = {
  "package.json": JSON.stringify({
    name: packageName,
    version: "0.1.0",
    private: true,
    type: "module",
    exports: { ".": "./src/index.ts", "./integration": "./src/integration.ts" },
    scripts: {
      build: "tsc --noEmit",
      typecheck: "tsc --noEmit",
      test: "vitest run",
      lint: "tsc --noEmit",
      clean: "rm -rf dist",
    },
    dependencies: {
      "@modreef/device-integration": "workspace:*",
      "@modreef/hal": "workspace:*",
    },
    devDependencies: { typescript: "^6.0.3", vitest: "^3.2.7" },
  }, null, 2) + "\n",
  "tsconfig.json": `${JSON.stringify({
    extends: "../../tsconfig.base.json",
    compilerOptions: { noEmit: true },
    include: ["src/**/*.ts", "test/**/*.ts"],
  }, null, 2)}\n`,
  "src/index.ts": `import type { CommandResult, DeviceCommand, DeviceDescriptor, DeviceDriver, DeviceState, DriverHealth } from "@modreef/hal";\n\nexport class ${pascal}Driver implements DeviceDriver {\n  readonly id: string;\n  readonly name = "${title} Driver";\n\n  constructor(private readonly deviceId: string) {\n    this.id = \`modreef.${slug}:\${deviceId}\`;\n  }\n\n  async discover(): Promise<DeviceDescriptor[]> { throw new Error("Implement discovery"); }\n  async connect(_deviceId: string): Promise<void> { throw new Error("Implement connection"); }\n  async disconnect(_deviceId: string): Promise<void> {}\n  async getDescriptor(_deviceId: string): Promise<DeviceDescriptor> { throw new Error("Implement descriptor"); }\n  async getState(_deviceId: string): Promise<DeviceState> { throw new Error("Implement state read"); }\n  async execute(_command: DeviceCommand): Promise<CommandResult> { throw new Error("Implement commands"); }\n  async health(): Promise<DriverHealth> {\n    return { driverId: this.id, healthy: false, checkedAt: new Date().toISOString(), message: "Not implemented" };\n  }\n}\n`,
  "src/integration.ts": `import { defineDeviceIntegration } from "@modreef/device-integration";\nimport { ${pascal}Driver } from "./index.js";\n\nexport const ${manifestName} = defineDeviceIntegration({\n  schemaVersion: 1,\n  id: "modreef.${slug}",\n  displayName: "${title}",\n  manufacturer: "TODO",\n  models: ["TODO"],\n  deviceClass: "other",\n  support: "experimental",\n  protocols: ["proprietary"],\n  capabilityKinds: [],\n  onboarding: { methods: ["manual"], requiresNativeMobileModule: false },\n  equipment: [],\n  documentation: "docs/device-profiles/${slug}.md",\n  match: () => null,\n  validateRegistration: (input) => {\n    if (!input || typeof input !== "object" || !("deviceId" in input) || typeof input.deviceId !== "string") {\n      throw new Error("Invalid ${title} registration");\n    }\n  },\n  createDriver: (input) => new ${pascal}Driver((input as { deviceId: string }).deviceId),\n});\n`,
  "test/integration.test.ts": `import { describe, expect, it } from "vitest";\nimport { ${manifestName} } from "../src/integration.js";\n\ndescribe("${title} integration", () => {\n  it("declares an experimental integration manifest", () => {\n    expect(${manifestName}.id).toBe("modreef.${slug}");\n    expect(${manifestName}.support).toBe("experimental");\n  });\n});\n`,
  "README.md": `# ${title} device integration\n\nStatus: experimental.\n\nSee \`docs/device-profiles/${slug}.md\` for evidence, provenance, supported firmware, and bench-test results.\n`,
};

for (const [name, contents] of Object.entries(files)) {
  const target = resolve(packageDirectory, name);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, contents);
}

const profilePath = resolve(root, "docs", "device-profiles", `${slug}.md`);
await writeFile(profilePath, `# ${title} device profile\n\n## Status\n\nExperimental\n\n## Identity\n\n- Manufacturer: TODO\n- Model: TODO\n- Firmware tested: TODO\n\n## Integration provenance and legal basis\n\nDocument how behavior was independently observed and confirm that no vendor code, credentials, copyrighted manuals, or restricted captures are included.\n\n## Capabilities\n\n- TODO\n\n## Bench-test record\n\n- Hardware isolation and safe-load setup: TODO\n- Discovery: TODO\n- State reads: TODO\n- Commands and observed-state confirmation: TODO\n- Offline and restart behavior: TODO\n`);

const registryPackagePath = resolve(root, "packages/device-integrations/package.json");
const registryPackage = JSON.parse(await readFile(registryPackagePath, "utf8"));
registryPackage.dependencies[packageName] = "workspace:*";
registryPackage.dependencies = Object.fromEntries(Object.entries(registryPackage.dependencies).sort());
await writeFile(registryPackagePath, `${JSON.stringify(registryPackage, null, 2)}\n`);

const registrySourcePath = resolve(root, "packages/device-integrations/src/index.ts");
let registrySource = await readFile(registrySourcePath, "utf8");
const importLine = `import { ${manifestName} } from "${packageName}/integration";\n`;
registrySource = registrySource.replace(
  "\nexport const builtInDeviceIntegrations",
  `\n${importLine}\nexport const builtInDeviceIntegrations`,
);
registrySource = registrySource.replace(
  "export const builtInDeviceIntegrations = new DeviceIntegrationRegistry([\n",
  `export const builtInDeviceIntegrations = new DeviceIntegrationRegistry([\n  ${manifestName},\n`,
);
registrySource = registrySource.replace(
  "export {\n",
  `export {\n  ${manifestName},\n`,
);
await writeFile(registrySourcePath, registrySource);

console.info(`Created ${packageName}`);
console.info(`Next: implement the TODOs, run pnpm install, then pnpm --filter ${packageName} test`);
