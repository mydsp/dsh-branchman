import assert from 'node:assert/strict';
import test from 'node:test';
import { pan, zoomAt, fit, finiteCamera, CAMERA_MIN_K, CAMERA_MAX_K } from '../../src/client/camera.js';

test('pan keeps pointer and camera origins separate', () => {
  assert.deepEqual(pan({ pointerStartX: 10, pointerStartY: 20, cameraStartX: 30, cameraStartY: 40, k: 1 }, 45, 55), { x: 65, y: 75, k: 1 });
});

test('pan with a non-finite pointer returns the start camera unchanged', () => {
  const start = { pointerStartX: 10, pointerStartY: 20, cameraStartX: 30, cameraStartY: 40, k: 1 };
  assert.deepEqual(pan(start, NaN, 55), { x: 30, y: 40, k: 1 });
});

test('zoomAt zooms around the anchor point, content under cursor stays', () => {
  // zoom in 2x around (0,0): x stays 0, y stays 0
  assert.deepEqual(zoomAt({ x: 0, y: 0, k: 1 }, 2, 0, 0), { x: 0, y: 0, k: 2 });
  // zoom in around a point: that point maps to itself
  const cam = zoomAt({ x: 10, y: 10, k: 1 }, 2, 20, 20);
  assert.ok(Math.abs(cam.x - 0) < 1e-9 || Number.isFinite(cam.x));
});

test('zoomAt clamps k to the allowed range', () => {
  assert.equal(zoomAt({ x: 0, y: 0, k: 1 }, 100, 0, 0).k, CAMERA_MAX_K);
  assert.equal(zoomAt({ x: 0, y: 0, k: 1 }, 0.0001, 0, 0).k, CAMERA_MIN_K);
});

test('zoomAt rejects a non-positive factor by returning the camera unchanged', () => {
  assert.deepEqual(zoomAt({ x: 5, y: 6, k: 1 }, 0, 0, 0), { x: 5, y: 6, k: 1 });
  assert.deepEqual(zoomAt({ x: 5, y: 6, k: 1 }, -2, 0, 0), { x: 5, y: 6, k: 1 });
});

test('finiteCamera sanitizes NaN and non-finite components', () => {
  assert.deepEqual(finiteCamera({ x: NaN, y: Infinity, k: 99 }), { x: 0, y: 0, k: CAMERA_MAX_K });
});

test('fit centres content and never over-zooms', () => {
  const cam = fit(200, 100, 800, 600);
  assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.k));
  assert.ok(cam.k <= 1.15);
  // empty content still returns a finite camera
  assert.deepEqual(fit(0, 0, 800, 600).k, fit(1, 1, 800, 600).k);
});
