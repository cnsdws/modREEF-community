export type QualificationStatus =
  | "unknown"
  | "experimental"
  | "supported"
  | "verified"
  | "unsupported";

export interface DeviceCapability {
  id: string;
  supported: boolean;
  details?: Record<string, string | number | boolean>;
}

export interface DeviceQualification {
  status: QualificationStatus;
  capabilities: DeviceCapability[];
  supportedDriverIds: string[];
  confidence: number;
  notes: string[];
}

export { ghomeWp12Qualification } from "./ghomeWp12.js";
export { qualificationForIdentity } from "./qualificationRegistry.js";
