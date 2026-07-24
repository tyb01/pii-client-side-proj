// Minimal ambient type - avoids pulling in the full @webgpu/types package
// for this one presence/adapter check.
interface NavigatorWithGpu extends Navigator {
  gpu?: { requestAdapter: () => Promise<unknown> };
}

/** Cheap presence check only - navigator.gpu existing doesn't mean a GPU adapter is actually obtainable. */
export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Actually requests a GPU adapter. navigator.gpu can exist while adapter
 * requests still fail (blocklisted GPU, outdated driver, headless browsers
 * without GPU flags all report the API but fail on first use) - this is the
 * check to gate real WebGPU usage on.
 */
export async function canUseWebGPU(): Promise<boolean> {
  if (!hasWebGPU()) return false;
  try {
    const adapter = await (navigator as NavigatorWithGpu).gpu?.requestAdapter();
    return adapter != null;
  } catch {
    return false;
  }
}
