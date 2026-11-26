import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pageStore, validate } from "./config.mjs";
import { createServer, parseAdminEnabled } from "./server.mjs";

test("YAML storage preserves source, rejects stale writes and unsafe paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homer-"));
  try {
    const source = "# comment\nshared: &base { tag: demo }\nservices:\n  - items:\n      - name: App\n        <<: *base\n";
    fs.writeFileSync(path.join(dir, "config.yml"), source);
    const store = pageStore(dir);
    const current = store.read("config");
    assert.equal(current.source, source);
    assert.equal(validate(source).services[0].items[0].tag, "demo");
    store.write("config", source + "title: New\n", current.revision);
    assert.throws(() => store.write("config", source, current.revision), { status: 409 });
    const backup = fs.readdirSync(path.join(dir, ".homer-backups"))[0];
    assert.equal(fs.readFileSync(path.join(dir, ".homer-backups", backup), "utf8"), source);
    assert.throws(() => store.read("../outside"), { status: 400 });
    fs.symlinkSync(path.join(dir, "config.yml"), path.join(dir, "alias.yml"));
    assert.throws(() => store.read("alias"), { status: 403 });
    assert.throws(() => validate("title: a\ntitle: b\n"), { status: 422 });
    assert.throws(() => validate("services: invalid"), { status: 422 });
    const page = store.write("second", "title: Page\n", null, true);
    assert.deepEqual(store.list(), ["config", "second"]);
    store.remove("second", page.revision);
    assert.throws(() => store.remove("config", current.revision), { status: 400 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("authenticated API, origin, CSRF, revision and disabled mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homer-"));
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets/config.yml"), "title: Original\n");
  const server = createServer({ root: dir, adminEnabled: true, username: "admin", password: "secret", subfolder: "/homer" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const api = origin + "/homer/admin/api/";
  try {
    assert.equal((await fetch(api + "pages")).status, 401);
    const login = await fetch(api + "login", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const { csrf } = await login.json();
    const current = await (await fetch(api + "pages/config", { headers: { Cookie: cookie } })).json();
    const data = JSON.stringify({ source: "title: Updated\n", revision: current.revision });
    const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf };
    assert.equal((await fetch(api + "pages/config", { method: "PUT", headers: { ...headers, Origin: "https://other.invalid" }, body: data })).status, 403);
    assert.equal((await fetch(api + "pages/config", { method: "PUT", headers: { ...headers, "X-CSRF-Token": "" }, body: data })).status, 403);
    assert.equal((await fetch(api + "pages/config", { method: "PUT", headers, body: data })).status, 200);
    assert.equal((await fetch(api + "pages/config", { method: "PUT", headers, body: data })).status, 409);
    assert.equal(fs.readFileSync(path.join(dir, "assets/config.yml"), "utf8"), "title: Updated\n");
    const backup = fs.readdirSync(path.join(dir, "assets/.homer-backups"))[0];
    assert.equal((await fetch(origin + "/assets/.homer-backups/" + backup)).status, 404);
    assert.equal((await fetch(api + "logout", { method: "POST", headers, body: "{}" })).status, 200);
    assert.equal((await fetch(api + "pages", { headers: { Cookie: cookie } })).status, 401);
    assert.throws(() => createServer({ root: dir, adminEnabled: true, username: "admin" }), /both ADMIN/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("admin switch is explicit and fail-closed", () => {
  assert.equal(parseAdminEnabled(), false);
  for (const value of ["0", "false", "FALSE"]) assert.equal(parseAdminEnabled(value), false);
  for (const value of ["1", "true", "TRUE"]) assert.equal(parseAdminEnabled(value), true);
  assert.throws(() => parseAdminEnabled("yes"), /ADMIN_ENABLED/);
  assert.throws(() => parseAdminEnabled(""), /ADMIN_ENABLED/);
});

test("disabled administration serves neither endpoints nor frontend, including subpaths", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "homer-disabled-"));
  const root = path.join(dir, "public");
  const adminRoot = path.join(dir, "private-admin");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.mkdirSync(path.join(adminRoot, "resources"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "Dashboard");
  fs.writeFileSync(path.join(root, "assets/config.yml"), "title: Original\n");
  fs.writeFileSync(path.join(adminRoot, "index.html"), "Administration");
  fs.writeFileSync(path.join(adminRoot, "resources/editor.js"), "private editor");
  fs.mkdirSync(path.join(root, "admin"));
  fs.writeFileSync(path.join(root, "admin/legacy.js"), "legacy admin");
  fs.symlinkSync(adminRoot, path.join(root, "alias"));
  try {
    for (const adminEnabled of [false, true]) {
      const server = createServer({ root, adminRoot, adminEnabled, username: "admin", password: "secret", subfolder: "/homer" });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + server.address().port;
      try {
        for (const prefix of ["", "/homer"]) {
          assert.equal(await (await fetch(origin + prefix + "/")).text(), "Dashboard");
          assert.equal((await fetch(origin + prefix + "/assets/config.yml")).status, 200);
          assert.equal((await fetch(origin + prefix + "/alias/resources/editor.js")).status, 404);
          assert.equal((await fetch(origin + prefix + "/admin/legacy.js")).status, 404);
          assert.equal((await fetch(origin + prefix + "/admin", { redirect: "manual" })).status, adminEnabled ? 308 : 404);
          assert.equal((await fetch(origin + prefix + "/admin/")).status, adminEnabled ? 200 : 404);
          assert.equal((await fetch(origin + prefix + "/%61dmin/resources/editor.js")).status, adminEnabled ? 200 : 404);
          assert.equal((await fetch(origin + prefix + "/admin/api/status")).status, adminEnabled ? 200 : 404);
          assert.equal((await fetch(origin + prefix + "/admin/api/pages")).status, adminEnabled ? 401 : 404);
          if (!adminEnabled) {
            for (const [method, route] of [["HEAD", ""], ["POST", "api/login"], ["POST", "api/logout"], ["POST", "api/validate"], ["POST", "api/pages"], ["PUT", "api/pages/config"], ["DELETE", "api/pages/secondary"]]) {
              assert.equal((await fetch(origin + prefix + "/admin/" + route, { method })).status, 404);
            }
          }
        }
      } finally { await new Promise(resolve => server.close(resolve)); }
    }
    const defaultServer = createServer({ root, adminRoot, username: "admin" });
    defaultServer.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
