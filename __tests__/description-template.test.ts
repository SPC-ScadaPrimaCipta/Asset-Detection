import { compareDescription } from "../lib/description-template";

describe("compareDescription", () => {
  it("generates correct fallback with all arguments", () => {
    const result = compareDescription(
      '30756-P 3" FROM 100 TO 200',
      '3"',
      '100',
      '200',
      '30756-P'
    );
    expect(result.fallback).toBe('30756-P 3" FROM 100 TO 200');
    expect(result.matches).toBe(true);
  });

  it("handles missing fromRef", () => {
    const result = compareDescription(
      '30756-P 3" TO 200',
      '3"',
      null,
      '200',
      '30756-P'
    );
    expect(result.fallback).toBe('30756-P 3" TO 200');
    expect(result.matches).toBe(true);
  });
});
