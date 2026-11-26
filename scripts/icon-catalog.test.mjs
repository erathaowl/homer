import { test } from "node:test";
import assert from "node:assert/strict";
import { iconCatalog } from "./icon-catalog.mjs";

test("installed Font Awesome package provides the searchable free icon catalog", () => {
  const icons = iconCatalog();
  assert.ok(icons.length > 1000, "Expected the full free icon catalog");
  for (const icon of ["fas fa-server", "far fa-bell", "fab fa-github"]) {
    assert.ok(icons.includes(icon), "Missing icon " + icon);
  }
  assert.equal(icons.length, new Set(icons).size);
});
