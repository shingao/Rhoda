import { describe, expect, it } from "vitest";
import { restoreTagScopes } from "./tags";

describe("restoreTagScopes", () => {
  const before = { voyages: { icon: "plane" }, "voyages/japon": { color: 2 }, maison: { icon: "house" } };
  it("undoes a rename: old settings back, new name cleared, others kept", () => {
    const after = { trips: { icon: "plane" }, "trips/japon": { color: 2 }, maison: { icon: "home" } };
    expect(restoreTagScopes(after, before, ["voyages", "trips"])).toEqual({ voyages: { icon: "plane" }, "voyages/japon": { color: 2 }, maison: { icon: "home" } });
  });
  it("undoes a removal", () => {
    expect(restoreTagScopes({ maison: { icon: "house" } }, before, ["voyages"])).toEqual(before);
  });
});
