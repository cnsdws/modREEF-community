export interface InspectionSection {
  title: string;
  entries: Record<string, unknown>;
}

export interface DeviceInspection {
  id: string;

  sections: InspectionSection[];
}

export { inspectDevice } from "./deviceInspector.js";
