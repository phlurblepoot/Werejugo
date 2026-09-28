import { describe, expect, test } from "vitest";
import { countryCode, mergePorts, parseLocodeCoords, portSearchText, titleCase, type PortRecord } from "./referenceMerge.js";

const rec = (p: Partial<PortRecord> & Pick<PortRecord, "name" | "lat" | "lng" | "source">): PortRecord => ({
  country: "US", locode: null, aliases: [], ...p,
});

describe("reference data helpers", () => {
  test("UN/LOCODE coordinates are degrees and minutes", () => {
    expect(parseLocodeCoords("2031N 08656W")).toEqual({ lat: 20.5167, lng: -86.9333 });
    expect(parseLocodeCoords("3623S 02525E")).toEqual({ lat: -36.3833, lng: 25.4167 });
    expect(parseLocodeCoords("")).toBeNull();
    expect(parseLocodeCoords("junk")).toBeNull();
  });

  test("country names become ISO codes, including the World Port Index's spellings", () => {
    expect(countryCode("United States")).toBe("US");
    expect(countryCode("U.S.A.")).toBe("US");
    expect(countryCode("Mexico")).toBe("MX");
    expect(countryCode("U.S. Virgin Islands")).toBe("VI");
    expect(countryCode("Bonaire, Sint Eustatius and Saba")).toBe("BQ");
    expect(countryCode("Atlantis")).toBeNull();
  });

  test("upper-case names are title-cased", () => {
    expect(titleCase("SAN MIGUEL DE COZUMEL")).toBe("San Miguel de Cozumel");
    expect(titleCase("PAARDEN BAAI - (ORANJESTAD)")).toBe("Paarden Baai - (Oranjestad)");
    expect(titleCase("St. John's")).toBe("St. John's");
  });

  test("search text drops accents and case, and includes aliases", () => {
    expect(portSearchText({ name: "Roatán", aliases: ["Coxen Hole"] })).toBe("roatan coxen hole");
  });
});

describe("mergePorts", () => {
  test("the same port from several sources becomes one, named by the best source, with the others as aliases", () => {
    const out = mergePorts([
      rec({ name: "Cozumel", lat: 20.5167, lng: -86.9333, source: "unlocode", locode: "MXCZM", country: "MX" }),
      rec({ name: "Cozumel", lat: 20.5, lng: -86.97, source: "wpi", country: "MX", aliases: ["San Miguel de Cozumel"] }),
      rec({ name: "Cozumel", lat: 20.5109, lng: -86.9496, source: "searoute", locode: "MXCZM", country: "MX" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Cozumel", country: "MX", locode: "MXCZM", source: "wpi" });
    expect(out[0].aliases).toEqual(["San Miguel de Cozumel"]);
    // Coordinates from the most precise source (searoute's), not the 2-decimal World Port Index.
    expect(out[0].lat).toBeCloseTo(20.5109, 4);
  });

  test("curated cruise ports win their names", () => {
    const out = mergePorts([
      rec({ name: "Fort Lauderdale", lat: 26.09, lng: -80.12, source: "wpi" }),
      rec({ name: "Fort Lauderdale (Port Everglades)", lat: 26.0918, lng: -80.1156, source: "curated" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Fort Lauderdale (Port Everglades)", source: "curated", aliases: ["Fort Lauderdale"] });
  });

  test("different names at the same spot merge; different names a few km apart don't", () => {
    const out = mergePorts([
      rec({ name: "Costa Maya", lat: 18.72, lng: -87.69, source: "wpi", country: "MX" }),
      rec({ name: "Mahahual", lat: 18.72, lng: -87.69, source: "wpi", country: "MX" }),
      rec({ name: "Xcalak", lat: 18.27, lng: -87.83, source: "wpi", country: "MX" }),
      rec({ name: "Miami", lat: 25.7743, lng: -80.1799, source: "curated" }),
      rec({ name: "Miami Beach", lat: 25.79, lng: -80.13, source: "unlocode" }),
    ]);
    expect(out.map((p) => p.name).sort()).toEqual(["Costa Maya", "Miami", "Miami Beach", "Xcalak"]);
    expect(out.find((p) => p.name === "Costa Maya")!.aliases).toEqual(["Mahahual"]);
    // A neighbour under another name gives its name as an alias, not its code.
    const miami = mergePorts([
      rec({ name: "Miami", lat: 25.7743, lng: -80.1799, source: "curated" }),
      rec({ name: "Miami River", lat: 25.78, lng: -80.18, source: "unlocode", locode: "USXXX" }),
    ]);
    expect(miami).toEqual([expect.objectContaining({ name: "Miami", locode: null, aliases: ["Miami River"] })]);
  });

  test("the same name close by in another country is a source's mistake, and merges", () => {
    const out = mergePorts([
      rec({ name: "Southampton", lat: 50.895, lng: -1.404, source: "curated", country: "GB" }),
      rec({ name: "Southampton", lat: 50.9097, lng: -1.4044, source: "searoute", country: "BM", locode: "BMSOU" }),
      rec({ name: "Southampton", lat: 32.25, lng: -64.85, source: "unlocode", country: "BM" }),
    ]);
    expect(out.map((p) => `${p.name} ${p.country}`).sort()).toEqual(["Southampton BM", "Southampton GB"]);
    expect(out.find((p) => p.country === "GB")!.locode).toBeNull();
  });

  test("the same name in another country stays separate", () => {
    const out = mergePorts([
      rec({ name: "Victoria", lat: 48.43, lng: -123.37, source: "unlocode", country: "CA" }),
      rec({ name: "Victoria", lat: -4.62, lng: 55.45, source: "wpi", country: "SC" }),
    ]);
    expect(out).toHaveLength(2);
  });
});
