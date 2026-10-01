// Camera math — the pure core of the overview canvas (B04/S02).
//
// The old code stored `{x, y, ...cameraRef.current}` on pointer-down and then
// read `drag.vx`/`drag.vy` on move, which do not exist → `NaN`. It also let
// every 4-second data refresh trigger a fresh `fit()` that yanked the user's
// camera back. This module fixes both at the source:
//   - drag state has ONE fixed shape with no object spread over the camera;
//   - every result is validated to be finite, so NaN can never enter the canvas;
//   - pan and zoom are pure functions the UI calls; the UI alone decides when
//     to apply them (never as a side effect of a data refresh).

export type Camera = { x: number; y: number; k: number };

export type DragStart = {
  pointerStartX: number;
  pointerStartY: number;
  cameraStartX: number;
  cameraStartY: number;
  k: number;
};

export const CAMERA_MIN_K = 0.2;
export const CAMERA_MAX_K = 2.5;

const clampK = (k: number): number => {
  if (!Number.isFinite(k)) return 1;
  return Math.max(CAMERA_MIN_K, Math.min(CAMERA_MAX_K, k));
};

/** A finite camera, replacing any non-finite component with a safe value. */
export function finiteCamera(camera: Partial<Camera>): Camera {
  const x = Number.isFinite(camera.x) ? (camera.x as number) : 0;
  const y = Number.isFinite(camera.y) ? (camera.y as number) : 0;
  const k = clampK(camera.k as number);
  return { x, y, k };
}

/**
 * Pan the camera by the pointer delta since drag start. Pointer origin and
 * camera origin are kept separate (the old code merged them via spread and then
 * read non-existent fields).
 */
export function pan(start: DragStart, pointerX: number, pointerY: number): Camera {
  if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return { x: start.cameraStartX, y: start.cameraStartY, k: start.k };
  return finiteCamera({
    x: start.cameraStartX + (pointerX - start.pointerStartX),
    y: start.cameraStartY + (pointerY - start.pointerStartY),
    k: start.k,
  });
}

/**
 * Zoom by `factor` around the anchor point (px, py) in canvas space, so the
 * content under the cursor stays under the cursor. factor > 1 zooms in.
 */
export function zoomAt(camera: Camera, factor: number, px: number, py: number): Camera {
  if (!Number.isFinite(factor) || factor <= 0) return finiteCamera(camera);
  const k = clampK(camera.k * factor);
  const scale = k / camera.k;
  return finiteCamera({
    k,
    x: px - (px - camera.x) * scale,
    y: py - (py - camera.y) * scale,
  });
}

/**
 * Fit the camera so a content box of `width`×`height` is centred in a viewport
 * of `vw`×`vh`, never zooming past 1×. Returns a finite camera even for empty
 * content or a zero-sized viewport.
 */
export function fit(width: number, height: number, vw: number, vh: number, maxK = 1.15): Camera {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const vpW = Math.max(1, Number.isFinite(vw) ? vw : 1);
  const vpH = Math.max(1, Number.isFinite(vh) ? vh : 1);
  const k = clampK(Math.min(maxK, Math.min((vpW - 24) / w, (vpH - 24) / h)));
  return finiteCamera({ k, x: (vpW - w * k) / 2, y: (vpH - h * k) / 2 });
}
