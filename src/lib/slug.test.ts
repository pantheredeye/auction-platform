import { describe, it, expect } from "vitest";
import { slugify, generateSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("My Auction Title")).toBe("my-auction-title");
  });

  it("removes special characters", () => {
    expect(slugify("Auction! @#$% Title")).toBe("auction-title");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("-hello-")).toBe("hello");
  });
});

describe("generateSlug", () => {
  it("produces slugified-title-<6char> format", () => {
    const slug = generateSlug("My Auction Title");
    expect(slug).toMatch(/^my-auction-title-[a-zA-Z0-9_-]{6}$/);
  });

  it("has 6-char nanoid suffix", () => {
    const slug = generateSlug("Test");
    const parts = slug.split("-");
    const suffix = parts[parts.length - 1];
    expect(suffix).toHaveLength(6);
  });

  it("removes special characters from title portion", () => {
    const slug = generateSlug("Hello! World@");
    expect(slug).toMatch(/^hello-world-[a-zA-Z0-9_-]{6}$/);
  });

  it("generates unique slugs for same title", () => {
    const slug1 = generateSlug("Same Title");
    const slug2 = generateSlug("Same Title");
    expect(slug1).not.toBe(slug2);
  });
});
