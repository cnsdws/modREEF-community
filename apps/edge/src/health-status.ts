import { statfsSync } from "node:fs";
import type {
  EdgeHealthCheck,
  EdgeHealthStatus,
} from "@modreef/api-contract";

import { getAutomationRuntimeHealth } from "./automation-runtime.js";
import {
  dataDirectory,
  getTwin,
  runtimeStore,
} from "./equipment-runtime.js";

export interface EdgeHealthSnapshot {
  status: EdgeHealthStatus;
  checks: EdgeHealthCheck[];
}

const statusRank: Record<EdgeHealthStatus, number> = {
  healthy: 0,
  degraded: 1,
  unhealthy: 2,
};

function databaseCheck(): EdgeHealthCheck {
  try {
    runtimeStore.checkHealth();
    return {
      name: "database",
      status: "healthy",
      message: "Database is readable and writable",
    };
  } catch (error) {
    return {
      name: "database",
      status: "unhealthy",
      message: `Database check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function evaluateAutomationHealth(
  automation: ReturnType<typeof getAutomationRuntimeHealth>,
  monotonicNow: number,
): EdgeHealthCheck {
  if (automation.lastError) {
    return {
      name: "automation",
      status: "degraded",
      message: `Latest schedule pass failed: ${automation.lastError}`,
    };
  }

  if (automation.lastCompletedAt === undefined) {
    const startingFor = monotonicNow - automation.startedAt;

    return startingFor <= 10_000
      ? {
          name: "automation",
          status: "healthy",
          message: "Automation scheduler is starting",
        }
      : {
          name: "automation",
          status: "unhealthy",
          message: "Automation scheduler has not completed a pass",
        };
  }

  const heartbeatAge = monotonicNow - automation.lastCompletedAt;

  return heartbeatAge <= 10_000
    ? {
        name: "automation",
        status: "healthy",
        message: automation.running
          ? "Automation scheduler is running"
          : "Automation scheduler heartbeat is current",
      }
    : {
        name: "automation",
        status: "unhealthy",
        message: `Automation heartbeat is ${Math.round(
          heartbeatAge / 1000,
        )} seconds old`,
      };
}

function automationCheck(monotonicNow: number): EdgeHealthCheck {
  return evaluateAutomationHealth(
    getAutomationRuntimeHealth(),
    monotonicNow,
  );
}

function clockCheck(now: number): EdgeHealthCheck {
  const earliestPlausibleTime = Date.UTC(2025, 0, 1);
  const latestPlausibleTime = Date.UTC(2100, 0, 1);
  const plausible =
    Number.isFinite(now) &&
    now >= earliestPlausibleTime &&
    now < latestPlausibleTime;

  return plausible
    ? {
        name: "clock",
        status: "healthy",
        message: "System clock is plausible",
      }
    : {
        name: "clock",
        status: "unhealthy",
        message: "System clock is outside the supported range",
      };
}

function storageCheck(): EdgeHealthCheck {
  try {
    const statistics = statfsSync(dataDirectory);
    const freeBytes = statistics.bavail * statistics.bsize;
    const totalBytes = statistics.blocks * statistics.bsize;
    const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 0;
    const freeMegabytes = Math.round(freeBytes / (1024 * 1024));

    if (freeBytes < 64 * 1024 * 1024 || freeRatio < 0.01) {
      return {
        name: "storage",
        status: "unhealthy",
        message: `Storage critically low: ${freeMegabytes} MB free`,
      };
    }

    if (freeBytes < 256 * 1024 * 1024 || freeRatio < 0.05) {
      return {
        name: "storage",
        status: "degraded",
        message: `Storage low: ${freeMegabytes} MB free`,
      };
    }

    return {
      name: "storage",
      status: "healthy",
      message: `${freeMegabytes} MB storage free`,
    };
  } catch (error) {
    return {
      name: "storage",
      status: "unhealthy",
      message: `Storage check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function equipmentCheck(): EdgeHealthCheck {
  try {
    const twin = getTwin();
    const managedDeviceIds = new Set(
      (twin.devices ?? []).map((device) => device.id),
    );
    const equipment = twin.equipment.filter((item) =>
      item.binding?.deviceId
        ? managedDeviceIds.has(item.binding.deviceId)
        : false,
    );

    if (equipment.length === 0) {
      return {
        name: "equipment",
        status: "healthy",
        message: "No managed equipment is configured",
      };
    }

    const critical = equipment.filter(
      (item) => item.healthStatus === "critical",
    );

    if (critical.length > 0) {
      return {
        name: "equipment",
        status: "unhealthy",
        message: `${critical.length} equipment item${
          critical.length === 1 ? " is" : "s are"
        } critical`,
      };
    }

    const impaired = equipment.filter(
      (item) =>
        item.connectionStatus !== "online" ||
        item.healthStatus === "warning" ||
        item.healthStatus === "attention",
    );

    if (impaired.length > 0) {
      return {
        name: "equipment",
        status: "degraded",
        message: `${impaired.length} equipment item${
          impaired.length === 1 ? " needs" : "s need"
        } attention`,
      };
    }

    return {
      name: "equipment",
      status: "healthy",
      message: `${equipment.length} equipment item${
        equipment.length === 1 ? " is" : "s are"
      } online`,
    };
  } catch (error) {
    return {
      name: "equipment",
      status: "unhealthy",
      message: `Equipment check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function createEdgeHealthSnapshot(
  now = Date.now(),
  monotonicNow = performance.now(),
): EdgeHealthSnapshot {
  const checks = [
    databaseCheck(),
    automationCheck(monotonicNow),
    clockCheck(now),
    storageCheck(),
    equipmentCheck(),
  ];
  const status = checks.reduce<EdgeHealthStatus>(
    (worst, check) =>
      statusRank[check.status] > statusRank[worst]
        ? check.status
        : worst,
    "healthy",
  );

  return { status, checks };
}
