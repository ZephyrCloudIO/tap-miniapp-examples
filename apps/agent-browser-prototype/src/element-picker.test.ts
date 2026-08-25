import { describe, expect, it } from "@rstest/core";
import {
  containedFramePoint,
  representationLabel,
} from "./element-picker";

describe("element picker frame coordinates", () => {
  it("maps a pointer through horizontal letterboxing", () => {
    const point = containedFramePoint(
      { left: 100, top: 20, width: 800, height: 600 },
      { width: 1_600, height: 900 },
      500,
      320,
    );

    expect(point).toEqual({ xRatio: 0.5, yRatio: 0.5 });
  });

  it("rejects clicks in an object-fit letterbox", () => {
    expect(
      containedFramePoint(
        { left: 0, top: 0, width: 800, height: 800 },
        { width: 1_600, height: 900 },
        400,
        100,
      ),
    ).toBeNull();
  });

  it("keeps boundary points bounded and exposes human labels", () => {
    expect(
      containedFramePoint(
        { left: 10, top: 10, width: 400, height: 200 },
        { width: 400, height: 200 },
        410,
        210,
      ),
    ).toEqual({ xRatio: 1, yRatio: 1 });
    expect(representationLabel("selector")).toBe("Selector");
    expect(representationLabel("html")).toBe("HTML");
    expect(representationLabel("png")).toBe("PNG");
  });
});
