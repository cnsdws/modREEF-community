export const yinmikWaterProductId = "u5xgcpcngk3pfxb4";

export function isYinmikWaterProduct(productId: string | undefined): boolean {
  return productId?.toLowerCase() === yinmikWaterProductId;
}
