import { describe, expect, it } from "vitest";
import { meetsRequirement, resolveRequirement } from "./bidder-requirement";

describe("resolveRequirement", () => {
  it("returns orgDefault when override is null", () => {
    expect(resolveRequirement("guest", null)).toBe("guest");
  });

  it("returns override when provided", () => {
    expect(resolveRequirement("guest", "card_on_file")).toBe("card_on_file");
  });

  it("override wins even if lower than orgDefault", () => {
    expect(resolveRequirement("card_on_file", "guest")).toBe("guest");
  });
});

describe("meetsRequirement", () => {
  it("higher status meets lower requirement", () => {
    expect(meetsRequirement("card_on_file", "registered")).toBe(true);
  });

  it("lower status does not meet higher requirement", () => {
    expect(meetsRequirement("guest", "card_on_file")).toBe(false);
  });

  it("equal status meets equal requirement", () => {
    expect(meetsRequirement("registered", "registered")).toBe(true);
    expect(meetsRequirement("guest", "guest")).toBe(true);
  });
});
