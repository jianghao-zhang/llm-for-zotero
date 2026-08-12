import { assert } from "chai";
import {
  getCursorAnchoredPanDelta,
  installMermaidDragPan,
} from "../src/modules/contextPanel/standaloneMermaidWindow";

class FakePointerEvent extends Event {
  constructor(
    type: string,
    readonly pointerId: number,
    readonly clientX: number,
    readonly clientY: number,
    readonly button = 0,
  ) {
    super(type, { cancelable: true });
  }
}

class FakeViewport extends EventTarget {
  scrollLeft = 100;
  scrollTop = 80;
  capturedPointer: number | null = null;
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
  };

  setPointerCapture(pointerId: number) {
    this.capturedPointer = pointerId;
  }

  hasPointerCapture(pointerId: number) {
    return this.capturedPointer === pointerId;
  }

  releasePointerCapture(pointerId: number) {
    if (this.capturedPointer === pointerId) this.capturedPointer = null;
  }
}

describe("standalone Mermaid drag-to-pan", function () {
  it("moves both scroll axes while the primary pointer is held", function () {
    const viewport = new FakeViewport();
    const dispose = installMermaidDragPan(viewport as unknown as HTMLElement);

    const down = new FakePointerEvent("pointerdown", 7, 100, 100);
    viewport.dispatchEvent(down);
    assert.equal(down.defaultPrevented, true);
    assert.equal(viewport.capturedPointer, 7);
    assert.equal(viewport.classes.has("llm-mermaid-is-panning"), true);

    const move = new FakePointerEvent("pointermove", 7, 70, 40);
    viewport.dispatchEvent(move);
    assert.equal(viewport.scrollLeft, 130);
    assert.equal(viewport.scrollTop, 140);

    viewport.dispatchEvent(new FakePointerEvent("pointerup", 7, 70, 40));
    assert.equal(viewport.capturedPointer, null);
    assert.equal(viewport.classes.has("llm-mermaid-is-panning"), false);

    dispose();
  });

  it("keeps the same normalized SVG point under the zoom cursor", function () {
    const correction = getCursorAnchoredPanDelta(
      { left: 100, top: 80, width: 400, height: 200 },
      { left: 20, top: 30, width: 800, height: 400 },
      400,
      130,
    );

    // The cursor was at 75% width / 25% height before zoom. Applying this
    // correction puts that exact normalized point back at (400, 130).
    assert.deepEqual(correction, { x: -220, y: 0 });
  });

  it("ignores secondary-button drags and detaches cleanly", function () {
    const viewport = new FakeViewport();
    const dispose = installMermaidDragPan(viewport as unknown as HTMLElement);

    viewport.dispatchEvent(new FakePointerEvent("pointerdown", 2, 50, 50, 2));
    viewport.dispatchEvent(new FakePointerEvent("pointermove", 2, 10, 10, 2));
    assert.equal(viewport.scrollLeft, 100);
    assert.equal(viewport.scrollTop, 80);

    dispose();
    viewport.dispatchEvent(new FakePointerEvent("pointerdown", 3, 50, 50));
    viewport.dispatchEvent(new FakePointerEvent("pointermove", 3, 10, 10));
    assert.equal(viewport.scrollLeft, 100);
    assert.equal(viewport.scrollTop, 80);
  });

  it("reports unbounded x/y deltas for a free canvas", function () {
    const viewport = new FakeViewport();
    const deltas: Array<[number, number]> = [];
    installMermaidDragPan(viewport as unknown as HTMLElement, {
      onPan: (x, y) => deltas.push([x, y]),
    });

    viewport.dispatchEvent(new FakePointerEvent("pointerdown", 9, 200, 120));
    viewport.dispatchEvent(new FakePointerEvent("pointermove", 9, 225, 55));
    viewport.dispatchEvent(new FakePointerEvent("pointermove", 9, 205, 75));

    assert.deepEqual(deltas, [
      [25, -65],
      [-20, 20],
    ]);
    assert.equal(viewport.scrollLeft, 100);
    assert.equal(viewport.scrollTop, 80);
  });
});
