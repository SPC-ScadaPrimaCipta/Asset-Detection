export function referenceCropUrl(
  legendId: string,
  symbolId: string,
  cropHash: string | null | undefined
): string {
  const base = `/api/legends/${legendId}/symbols/${symbolId}/crop`;
  return cropHash ? `${base}?v=${encodeURIComponent(cropHash)}` : base;
}
