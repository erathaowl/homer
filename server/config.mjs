import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { isMap, parseDocument } from "yaml";

export const revision = (source) => createHash("sha256").update(source).digest("hex");

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validate(source) {
  if (typeof source !== "string" || Buffer.byteLength(source) > 1024 * 1024) {
    throw new HttpError(413, "Configuration must be YAML text under 1 MiB.");
  }
  const doc = parseDocument(source, { merge: true, uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents)) {
    throw new HttpError(422, doc.errors[0]?.message || "Expected a YAML mapping.");
  }
  let config;
  try {
    config = doc.toJS({ maxAliasCount: 100 });
    JSON.stringify(config);
  } catch {
    throw new HttpError(422, "Invalid or circular YAML aliases.");
  }
  const mapping = (value) => value && typeof value === "object" && !Array.isArray(value);
  for (const key of ["defaults", "colors", "message", "proxy", "hotkey"]) {
    if (config[key] != null && !mapping(config[key])) {
      throw new HttpError(422, key + " must be a mapping.");
    }
  }
  for (const key of ["title", "subtitle", "documentTitle", "externalConfig", "logo", "icon", "theme"]) {
    if (config[key] != null && typeof config[key] !== "string") {
      throw new HttpError(422, key + " must be text.");
    }
  }
  for (const key of ["header", "connectivityCheck"]) {
    if (config[key] != null && typeof config[key] !== "boolean") {
      throw new HttpError(422, key + " must be a boolean.");
    }
  }
  if (config.columns != null && !["auto", "1", "2", "3", "4", "6", "12"].includes(String(config.columns))) {
    throw new HttpError(422, "Invalid column count.");
  }
  if (config.links != null && (!Array.isArray(config.links) || config.links.some(link => !mapping(link) || typeof link.url !== "string"))) {
    throw new HttpError(422, "Links must be a list of mappings with URLs.");
  }
  if (config.services != null && (!Array.isArray(config.services) || config.services.some(group =>
    !mapping(group) || (group.items !== null && (!Array.isArray(group.items) || group.items.some(item =>
      !mapping(item) || typeof item.name !== "string" || !item.name.trim() ||
      (item.quick != null && (!Array.isArray(item.quick) || item.quick.some(link => !mapping(link) || typeof link.url !== "string")))
    )))))) {
    throw new HttpError(422, "Services must contain groups with item lists; every card needs a name and every quick link needs a URL.");
  }
  return config;
}

export function pageStore(directory) {
  const root = fs.realpathSync(directory);
  function filename(slug) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(slug) || ["default", "manifest"].includes(slug.toLowerCase())) {
      throw new HttpError(400, "Invalid page name.");
    }
    const file = path.join(root, slug + ".yml");
    try {
      if (!fs.lstatSync(file).isFile()) throw new HttpError(403, "Invalid configuration file.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return file;
  }

  function read(slug) {
    const file = filename(slug);
    if (!fs.existsSync(file)) throw new HttpError(404, "Page not found.");
    if (fs.statSync(file).size > 1024 * 1024) throw new HttpError(413, "Configuration is too large.");
    const source = fs.readFileSync(file, "utf8");
    return { source, revision: revision(source) };
  }

  function write(slug, source, expected, create = false) {
    const file = filename(slug);
    validate(source);
    if (create) {
      if (fs.existsSync(file)) throw new HttpError(409, "Page already exists.");
    } else if (read(slug).revision !== expected) {
      throw new HttpError(409, "The file has changed. Export your draft and reload.");
    }
    const temporary = path.join(root, ".homer-" + randomBytes(16).toString("hex"));
    let fd;
    try {
      fd = fs.openSync(temporary, "wx", create ? 0o644 : fs.statSync(file).mode & 0o777);
      fs.writeFileSync(fd, source, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      if (create) fs.linkSync(temporary, file);
      else {
        if (read(slug).revision !== expected) throw new HttpError(409, "The file has changed.");
        fs.renameSync(temporary, file);
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return read(slug);
  }

  return {
    list: () => fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.yml$/.test(entry.name))
      .map(entry => entry.name.slice(0, -4))
      .filter(slug => !["default", "manifest"].includes(slug.toLowerCase()))
      .sort((a, b) => a === "config" ? -1 : b === "config" ? 1 : a.localeCompare(b)),
    read,
    write,
    remove(slug, expected) {
      if (slug.toLowerCase() === "config") throw new HttpError(400, "The main configuration cannot be deleted.");
      if (read(slug).revision !== expected) throw new HttpError(409, "The file has changed.");
      fs.unlinkSync(filename(slug));
    },
  };
}
