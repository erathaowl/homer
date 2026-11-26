import schema from "../../.schema/config-schema.json";

const field = (type, options = {}) => ({ type, ...options });
const text = field("string");
const flag = field("boolean");
const number = field("integer");
const choice = (...values) => ({ enum: values });
const list = (items) => field("array", { items });
const secret = field("string", { secret: true });
const credentials = { apikey: secret };
const badges = {
  Beszel: "cpu mem disk", DockerSocketProxy: "running stopped errors", FreshRSS: "subscriptions unread",
  Glances: "", Healthchecks: "up down grace", HyperHDR: "running stopped",
  Immich: "users photos videos usage", Jellystat: "streams", Lidarr: "activity missing warnings errors",
  Prowlarr: "missing warnings errors", Sonarr: "activity missing warnings errors",
  Readarr: "activity missing warnings errors", Radarr: "activity missing warnings errors",
  LibrisLog: "reading want-to-read", Medusa: "news warnings errors", Memos: "memos version",
  Mylar: "wanted upcoming", Miniflux: "unread", NetAlertx: "total connected newdevices downalert",
  PiAlert: "total connected newdevices downalert", Plex: "streams series movies warnings errors",
  Portainer: "running dead misc", Proxmox: "vms vms_total lxcs lxcs_total disk mem cpu",
  qBittorrent: "torrents", Rtorrent: "torrents", SABnzbd: "downloads",
  Scrutiny: "passed failed unknown", Seerr: "updateAvailable restartRequired media pending processing issues",
  Tautulli: "streams", Tdarr: "queue errored", Traefik: "routers services middlewares certificates warnings errors",
  Transmission: "torrents", Wallabag: "", WUD: "running update",
};
const extra = {
  Authelia: {}, Beszel: { api_token: secret, system: text },
  CopyToClipboard: { clipboard: text },
  Emby: { ...credentials, libraryType: choice("music", "series", "movies"), legacyAuth: flag },
  FreshRSS: { username: text, password: secret },
  Gatus: { groups: list(text), hideaverages: flag },
  Glances: { stats: list(choice("load", "cpu", "mem", "swap")) },
  Gotify: credentials, Healthchecks: credentials,
  HomeAssistant: { ...credentials, items: list(choice("name", "version", "entities")), separator: text },
  Immich: credentials, Jellystat: credentials,
  ...Object.fromEntries(["Lidarr", "Prowlarr", "Sonarr", "Readarr", "Radarr"].map(type => [type, { ...credentials, legacyApi: flag }])),
  Linkding: { token: secret, limit: number, query: text },
  LibrisLog: credentials, Mealie: credentials, Medusa: credentials, Memos: credentials,
  Mylar: credentials, Miniflux: { ...credentials, style: choice("status", "counter") },
  NetAlertx: credentials, OctoPrint: { ...credentials, display: choice("text", "bar") },
  OpenHAB: { ...credentials, things: flag, items: flag },
  OpenWeather: { ...credentials, location: text, locationId: text, units: choice("metric", "imperial", "kelvin"), background: choice("square", "circle", "none") },
  PaperlessNG: credentials, PeaNUT: { device: text },
  PiHole: { ...credentials, apiVersion: choice(5, 6) },
  Ping: { method: choice("head", "get"), timeout: number },
  Plex: { token: secret }, Portainer: { ...credentials, environments: list(text) },
  Proxmox: { api_token: secret, node: text, warning_value: number, danger_value: number, hide_decimals: flag, small_font_on_small_screens: flag, small_font_on_desktop: flag },
  qBittorrent: credentials, Rtorrent: { xmlrpc: text, username: text, password: secret },
  SABnzbd: credentials, Seerr: credentials, Tautulli: credentials,
  Traefik: { basic_auth: secret }, Transmission: { auth: secret },
  TruenasScale: { api_token: secret }, UptimeKuma: { slug: text },
};

const types = Object.keys(import.meta.glob("../components/services/*.vue"))
  .map(path => path.split("/").pop().replace(".vue", ""))
  .filter(name => !name.startsWith("_")).sort();

schema.properties.theme = { ...choice("default", "neon", "walkxcode"), themePicker: true };
schema.properties.columns = choice("auto", "1", "2", "3", "4", "6", "12");
schema.properties.footer = { type: ["boolean", "string"], multiline: true };
schema.properties.stylesheet = list(text);
schema.definitions.Message.properties.style = choice("is-info", "is-success", "is-warning", "is-danger", "is-primary", "is-link", "is-dark");
schema.definitions.Message.properties.content.multiline = true;
for (const name of ["Item", "Link", "QuickLink"]) {
  schema.definitions[name].properties.target = choice("_self", "_blank", "_parent", "_top");
}
schema.definitions.Item.properties.type = choice(...types);
schema.definitions.Item.properties.tagstyle = { type: "string", tokens: ["is-primary", "is-link", "is-info", "is-success", "is-warning", "is-danger", "is-light", "is-dark", "is-rounded", "is-medium", "is-large"] };
schema.definitions.Item.properties.successCodes = list(number);
schema.definitions.Item.properties.background.color = true;
schema.definitions.QuickLink.properties.color.color = true;
for (const [key, spec] of Object.entries(schema.definitions.ColorSet.properties)) {
  if (!["card-shadow", "background-image"].includes(key)) spec.color = true;
}

export const sections = {
  General: ["title", "subtitle", "documentTitle", "logo", "icon", "header", "footer", "hotkey", "connectivityCheck", "updateIntervalMs"],
  Appearance: ["theme", "defaults", "columns", "colors", "stylesheet"],
  Navigation: ["links"],
  "Groups & cards": ["services"],
  Message: ["message"],
  Advanced: ["proxy", "externalConfig"],
};
export const rootFields = schema.properties;

export function resolveSchema(spec = {}, value, key) {
  let result = spec.$ref ? schema.definitions[spec.$ref.split("/").pop()] : spec;
  if (result === schema.definitions.Item) {
    const type = value?.type;
    const hide = badges[type];
    const selectedHide = Array.isArray(value?.hide) ? value.hide : [];
    result = { ...result, properties: { ...result.properties, ...(extra[type] || {}), hide: list(choice(...new Set([...(hide || "").split(" ").filter(Boolean), "serverError", ...selectedHide]))) } };
    if (!type || type === "Generic") result = { ...result, properties: Object.fromEntries(Object.entries(result.properties).filter(([name]) => !["endpoint", "headers", "useCredentials", "successCodes", "updateIntervalMs", "hide"].includes(name) || Object.hasOwn(value || {}, name))) };
  }
  if (key === "background" && !result.enum) result = { ...result, color: true };
  if (!result.type && !result.enum) {
    const inferred = Array.isArray(value) ? "array" : value !== null && typeof value === "object" ? "object" : typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string";
    result = { ...result, type: inferred };
  }
  return result;
}

export function initialValue(spec = {}) {
  const resolved = resolveSchema(spec);
  if (resolved.enum) return resolved.enum[0] ?? "";
  if (resolved.color) return "#3367d6";
  if (resolved.type === "object") {
    if (resolved.title === "Service") return { name: "New group", items: [] };
    if (resolved.title === "Item") return { name: "New card", url: "#" };
    if (["Link", "QuickLink"].includes(resolved.title)) return { name: "New link", url: "#" };
    return {};
  }
  if (resolved.type === "array") return [];
  if (resolved.type === "boolean") return true;
  if (resolved.type === "integer") return 0;
  if (Array.isArray(resolved.type)) return false;
  return "";
}

export const labelFor = key => String(key).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase());
