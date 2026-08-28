export type TuyaDps = Record<string, unknown>;
export type TuyaDpsWrite = Record<number, boolean | number>;

export interface GHomeWp12Transport {
  readStatus(): Promise<TuyaDps>;
  setValue(dps: number, value: boolean): Promise<void>;
  setValues(values: TuyaDpsWrite): Promise<void>;
}
