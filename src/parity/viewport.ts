export const DEFAULT_FHD = { name: "desktop", width: 1920, height: 1080 } as const;

export function resolveViewport(
  configViewports?: Array<{ name: string; width: number; height: number }>,
  name = "desktop",
): { width: number; height: number } {
  const list = configViewports?.length ? configViewports : [DEFAULT_FHD];
  const found = list.find((v) => v.name === name) ?? list[0];
  return { width: found.width, height: found.height };
}
