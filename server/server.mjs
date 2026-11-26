import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { HttpError, pageStore, validate } from "./config.mjs";

const hash = (value) => createHash("sha256").update(value).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));
const token = () => randomBytes(32).toString("hex");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".txt": "text/plain", ".map": "application/json",
};

async function body(req) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
    throw new HttpError(415, "Expected application/json.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

export function parseAdminEnabled(value = "0") {
  switch (value.toLowerCase()) {
    case "1": case "true": return true;
    case "0": case "false": return false;
    default: throw new Error("ADMIN_ENABLED must be 0, 1, false or true.");
  }
}

export function createServer({ root, adminRoot = path.resolve("dist-admin"), adminEnabled = false, username, password, subfolder = "", secure = false, origin = "" }) {
  root = fs.realpathSync(root);
  adminRoot = path.resolve(adminRoot);
  const enabled = adminEnabled === true;
  if (enabled && (!username || !password)) {
    throw new Error("Set both ADMIN_USERNAME and ADMIN_PASSWORD to non-empty values.");
  }
  if (enabled && origin && new URL(origin).origin !== origin) throw new Error("ADMIN_ORIGIN must be an origin without a path.");
  secure = secure || origin.startsWith("https://");
  const prefix = subfolder.replace(/\/+$/, "");
  if (prefix && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new Error("Invalid SUBFOLDER.");
  const sessions = new Map();
  const attempts = new Map();
  const store = enabled ? pageStore(path.join(root, "assets")) : null;
  let globalAttempts = { count: 0, expires: 0 };

  function prune() {
    const now = Date.now();
    for (const [key, session] of sessions) if (session.expires <= now) sessions.delete(key);
    for (const [key, attempt] of attempts) if (attempt.expires <= now) attempts.delete(key);
  }

  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      let url;
      try { url = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
      catch { throw new HttpError(400, "Invalid URL."); }
      const base = prefix && (url === prefix || url.startsWith(prefix + "/")) ? prefix : "";
      if (base && url === base) {
        res.writeHead(308, { Location: base + "/" });
        return res.end();
      }
      url = url.slice(base.length);
      const admin = url === "/admin" || url.startsWith("/admin/");
      if (admin && !enabled) throw new HttpError(404, "Not found.");
      const api = url.startsWith("/admin/api/");
      if (admin) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      }

      if (api) {
        prune();
        const route = url.slice("/admin/api/".length);
        const method = req.method;
        const cookieName = "homer_admin";
        const id = (req.headers.cookie || "").split(/;\s*/).find(value => value.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
        const session = sessions.get(id);
        const cookie = (value, age) => cookieName + "=" + value + "; Path=" + base + "/admin/; HttpOnly; SameSite=Strict; Max-Age=" + age + (secure ? "; Secure" : "");
        if (method === "GET" && route === "status") {
          return json(200, { enabled, authenticated: Boolean(session), csrf: session?.csrf });
        }
        if (!["GET", "HEAD"].includes(method)) {
          const expected = origin || (secure ? "https://" : "http://") + req.headers.host;
          if (req.headers.origin !== expected || req.headers["sec-fetch-site"] === "cross-site") {
            throw new HttpError(403, "Invalid request origin.");
          }
        }
        if (method === "POST" && route === "login") {
          const ip = req.socket.remoteAddress;
          const now = Date.now();
          if (globalAttempts.expires <= now) globalAttempts = { count: 0, expires: now + 300000 };
          const attempt = attempts.get(ip) || { count: 0, expires: now + 300000 };
          if (attempt.count >= 10 || globalAttempts.count >= 100) throw new HttpError(429, "Too many login attempts.");
          attempt.count++;
          globalAttempts.count++;
          attempts.set(ip, attempt);
          const input = await body(req);
          if (typeof input.username !== "string" || typeof input.password !== "string" ||
              !(equal(input.username, username) & equal(input.password, password))) {
            throw new HttpError(401, "Invalid username or password.");
          }
          if (id) sessions.delete(id);
          const newId = token();
          const csrf = token();
          sessions.set(newId, { csrf, expires: now + 28800000 });
          res.setHeader("Set-Cookie", cookie(newId, 28800));
          return json(200, { enabled: true, authenticated: true, csrf });
        }
        if (!session) throw new HttpError(401, "Sign in required.");
        if (method !== "GET" && req.headers["x-csrf-token"] !== session.csrf) throw new HttpError(403, "Invalid CSRF token.");
        if (method === "POST" && route === "logout") {
          sessions.delete(id);
          res.setHeader("Set-Cookie", cookie("", 0));
          return json(200, { authenticated: false });
        }
        if (method === "GET" && route === "pages") return json(200, { pages: store.list() });
        if (method === "POST" && route === "validate") {
          validate((await body(req)).source);
          return json(200, { valid: true });
        }
        if (method === "POST" && route === "pages") {
          const input = await body(req);
          if (typeof input.slug !== "string") throw new HttpError(400, "Page name required.");
          return json(201, store.write(input.slug, input.source, null, true));
        }
        const match = /^pages\/([a-zA-Z0-9_-]+)$/.exec(route);
        if (match) {
          const slug = match[1];
          if (method === "GET") return json(200, store.read(slug));
          if (method === "PUT") {
            const input = await body(req);
            return json(200, store.write(slug, input.source, input.revision));
          }
          if (method === "DELETE") {
            store.remove(slug, (await body(req)).revision);
            return json(200, { deleted: true });
          }
        }
        throw new HttpError(404, "Unknown endpoint.");
      }

      if (!["GET", "HEAD"].includes(req.method)) throw new HttpError(405, "Method not allowed.");
      if (url === "/admin") {
        res.writeHead(308, { Location: base + "/admin/" });
        return res.end();
      }
      if (url.split("/").some(part => part.startsWith(".")) || url.includes("\\") || url.includes("\0")) throw new HttpError(404, "Not found.");
      // Runtime internals and backup/temp files never live in the public directory.
      const staticRoot = admin ? fs.realpathSync(adminRoot) : root;
      const relativeUrl = admin ? url.slice("/admin".length) : url;
      let file = path.resolve(staticRoot, "." + relativeUrl);
      if (!file.startsWith(staticRoot + path.sep) && file !== staticRoot) throw new HttpError(404, "Not found.");
      if (!fs.existsSync(file)) throw new HttpError(404, "Not found.");
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      file = fs.realpathSync(file);
      if (!file.startsWith(staticRoot + path.sep) || !fs.statSync(file).isFile() || path.relative(staticRoot, file).split(path.sep).some(part => part.startsWith("."))) throw new HttpError(404, "Not found.");
      if (!admin && (path.relative(root, file).split(path.sep)[0] === "admin" || file === adminRoot || file.startsWith(adminRoot + path.sep))) throw new HttpError(404, "Not found.");
      const extension = path.extname(file).toLowerCase();
      const stat = fs.statSync(file);
      if (!admin) {
        res.setHeader("Cache-Control", url.startsWith("/resources/") ? "public, max-age=31536000, immutable" : "no-cache");
        // Block inline scripts and event handlers in dashboard HTML and active user assets.
        res.setHeader("Content-Security-Policy", "script-src 'self'; object-src 'none'; base-uri 'self'");
      }
      res.setHeader("Content-Type", MIME[extension] || "application/octet-stream");
      res.setHeader("Content-Length", stat.size);
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status || (error.code === "ENOENT" ? 404 : ["EACCES", "EROFS", "EPERM"].includes(error.code) ? 503 : 500);
      json(status, { error: error.status ? error.message : status === 503 ? "Configuration storage is not writable." : status === 404 ? "Not found." : "Server error." });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer({
    root: process.env.WEB_ROOT || "dist",
    adminRoot: process.env.ADMIN_WEB_ROOT || "dist-admin",
    adminEnabled: parseAdminEnabled(process.env.ADMIN_ENABLED),
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    subfolder: process.env.SUBFOLDER || "",
    secure: process.env.ADMIN_SECURE_COOKIE === "1",
    origin: process.env.ADMIN_ORIGIN || "",
  });
  server.listen(Number(process.env.PORT || 8080), process.env.IPV6_DISABLE === "1" ? "0.0.0.0" : "::");
}
