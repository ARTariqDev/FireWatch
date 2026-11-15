import assert from "node:assert/strict";
import test from "node:test";
import { findCountry, listCountries } from "../lib/countries.js";

test("country directory lists real country names with ISO codes and map focus", () => {
  const countries = listCountries();
  const pakistan = countries.find((country) => country.iso3 === "PAK");

  assert.ok(countries.length > 200);
  assert.ok(pakistan);
  assert.equal(pakistan.iso2, "PK");
  assert.equal(findCountry("PAK").iso2, "PK");
  assert.equal(pakistan.name, findCountry("PAK").name);
  assert.equal(pakistan.bbox.length, 4);
  assert.ok(Number.isFinite(pakistan.center.lng));
  assert.ok(Number.isFinite(pakistan.center.lat));
});
