import assert from "node:assert/strict";
import process from "node:process";

const [origin, enabled] = process.argv.slice(2);
const request = (route, options) => fetch(origin + route, { redirect: "manual", ...options });
assert.equal((await request("/")).status, 200);
assert.equal((await request("/assets/config.yml")).status, 200);
if (enabled === "0") {
  for (const route of ["/admin", "/admin/", "/admin/index.html", "/admin/api/status", "/admin/api/pages", "/admin/resources/editor.js"]) {
    assert.equal((await request(route)).status, 404, route);
  }
  assert.equal((await request("/admin/api/login", { method: "POST" })).status, 404);
  assert.equal((await request("/admin/api/pages/config", { method: "PUT" })).status, 404);
} else {
  const page = await request("/admin/");
  assert.equal(page.status, 200);
  const html = await page.text();
  const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  assert.ok(script, "Admin JavaScript entry must be present");
  const asset = new URL(script, origin + "/admin/");
  assert.ok(asset.pathname.startsWith("/admin/resources/"), "Admin bundle must be isolated");
  assert.equal((await fetch(asset)).status, 200);
  assert.equal((await request(asset.pathname.replace("/admin", ""))).status, 404);
  assert.equal((await request("/admin/api/pages")).status, 401);
  const status = await (await request("/admin/api/status")).json();
  assert.equal(status.enabled, true);
  const login = await request("/admin/api/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test", password: "ci-only" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const { csrf } = await login.json();
  const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf };
  const pageUrl = "/admin/api/pages/ci-smoke";
  assert.equal((await request("/admin/api/pages", {
    method: "POST", headers, body: JSON.stringify({ slug: "ci-smoke", source: "title: Smoke\n" }),
  })).status, 201);
  const original = await (await request(pageUrl, { headers })).json();
  const save = await request(pageUrl, {
    method: "PUT", headers, body: JSON.stringify({ source: "title: Saved\n", revision: original.revision }),
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(await (await request("/assets/ci-smoke.yml")).text(), "title: Saved\n");
  assert.equal((await request(pageUrl, {
    method: "DELETE", headers, body: JSON.stringify({ revision: saved.revision }),
  })).status, 200);
  assert.equal((await request("/assets/ci-smoke.yml")).status, 404);
  assert.equal((await request("/admin/api/logout", { method: "POST", headers, body: "{}" })).status, 200);
  assert.equal((await request("/admin/api/pages", { headers })).status, 401);
}
console.log("Container smoke test passed (ADMIN_ENABLED=" + enabled + ").");
