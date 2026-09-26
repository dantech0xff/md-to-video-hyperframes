import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listBrands, loadBrand } from "./brand.js";

const saved = process.env.BRANDS_DIR;
afterEach(() => {
  if (saved === undefined) delete process.env.BRANDS_DIR;
  else process.env.BRANDS_DIR = saved;
});

function userBrands(...kits: { id: string; name: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), "brands-"));
  for (const k of kits) {
    mkdirSync(join(root, k.id));
    writeFileSync(join(root, k.id, "brand.json"), JSON.stringify({ id: k.id, name: k.name }));
  }
  return root;
}

describe("brand kits", () => {
  it("loads the bundled kit and its alias", () => {
    delete process.env.BRANDS_DIR;
    expect(loadBrand("dan-tech").name).toBe("Dan Tech");
    expect(loadBrand("dan-tech-academy").dir).toBe(loadBrand("dan-tech").dir);
  });

  it("finds kits in BRANDS_DIR and lists them with the bundled ones", () => {
    process.env.BRANDS_DIR = userBrands({ id: "acme", name: "Acme Academy" });
    expect(loadBrand("acme").name).toBe("Acme Academy");
    expect(listBrands()).toEqual(expect.arrayContaining(["acme", "dan-tech"]));
  });

  it("lets a user kit replace a bundled kit with the same id", () => {
    const root = userBrands({ id: "dan-tech", name: "Dan Tech (custom)" });
    process.env.BRANDS_DIR = root;
    const brand = loadBrand("dan-tech");
    expect(brand.name).toBe("Dan Tech (custom)");
    expect(brand.dir).toBe(join(root, "dan-tech"));
    expect(listBrands().filter((id) => id === "dan-tech")).toHaveLength(1);
  });

  it("fills in what a minimal kit leaves out, and says what is wrong with a broken one", () => {
    const root = userBrands({ id: "acme", name: "Acme Academy" });
    process.env.BRANDS_DIR = root;
    const acme = loadBrand("acme");
    expect(acme).toMatchObject({ id: "acme", name: "Acme Academy", shortName: "Acme Academy", website: "", tagline: "", defaultStyle: "dantech", logo: {} });
    expect(acme.cta).toEqual({ landscape: { title: "Acme Academy", subtitle: "" }, portrait: { title: "Acme Academy", subtitle: "" } });
    mkdirSync(join(root, "broken"));
    writeFileSync(join(root, "broken", "brand.json"), JSON.stringify({ name: "Broken", wordmark: "Broken", logo: { onDark: "../elsewhere.png" } }));
    expect(() => loadBrand("broken")).toThrow(/^Brand kit broken: .*logo\.onDark: a file in the brand kit's folder/);
    expect(() => loadBrand("broken")).toThrow(/wordmark: Invalid input: expected array/);
    writeFileSync(join(root, "broken", "brand.json"), "{");
    expect(() => loadBrand("broken")).toThrow(/Brand kit broken: brand\.json is not valid JSON/);
  });

  it("rejects ids that are paths", () => {
    expect(() => loadBrand("../dan-tech")).toThrow(/Invalid brand id/);
    expect(() => loadBrand("a/b")).toThrow(/Invalid brand id/);
  });

  it("says where it looked when a kit is missing", () => {
    delete process.env.BRANDS_DIR;
    expect(() => loadBrand("nope")).toThrow(/Brand kit not found: nope \(looked in .*assets[\\/]brand\)/);
  });
});
