import assert from "node:assert/strict";
import test from "node:test";
import { fitPadding } from "../app/components/globe/camera.js";

test("keeps normal viewport padding unchanged", () => {
  const padding = { top: 100, bottom: 100, left: 460, right: 100 };
  assert.deepEqual(fitPadding(padding, 1440, 900), padding);
});

test("leaves a usable map area when padding exceeds the viewport", () => {
  const padding = fitPadding({ top: 140, bottom: 420, left: 100, right: 100 }, 160, 300);
  assert.ok(padding.top + padding.bottom <= 180);
  assert.ok(padding.left + padding.right <= 80);
  assert.ok(padding.bottom > padding.top);
  assert.equal(fitPadding({ top: 1, bottom: 1, left: 1, right: 1 }, 0, 300), null);
});
