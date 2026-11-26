<script setup>
import { computed, onMounted, onUnmounted, provide, ref, shallowRef } from "vue";
import { isMap, parseDocument } from "yaml";
import ConfigField from "./ConfigField.vue";
import { rootFields, sections } from "./schema.js";
import iconMetadata from "@fortawesome/fontawesome-free/metadata/icons.json";
const iconOptions = Object.entries(iconMetadata).flatMap(([name, data]) => (data.free || []).map(style => ({ solid: "fas", regular: "far", brands: "fab" })[style]).filter(Boolean).map(prefix => prefix + " fa-" + name));

const enabled = ref(null);
const authenticated = ref(false);
const csrf = ref("");
const username = ref("");
const password = ref("");
const pages = ref([]);
const page = ref("config");
const tab = ref("General");
const source = ref("");
const saved = ref("");
const revision = ref("");
const document = shallowRef(null);
const change = ref(0);
const drag = ref(null);
const error = ref("");
const notice = ref("");
const busy = ref(false);
const search = ref("");
const newPage = ref("");
const preview = ref(false);
const dark = ref(false);
const dirty = computed(() => source.value !== saved.value);
const valid = computed(() => document.value && !document.value.errors.length && isMap(document.value.contents));
const rawOnly = computed(() => !valid.value);
const config = computed(() => {
  change.value;
  try { return valid.value ? document.value.toJS({ maxAliasCount: 100 }) : {}; } catch { return {}; }
});
const external = computed(() => config.value.externalConfig);
const fields = computed(() => {
  const keys = [...(sections[tab.value] || [])];
  if (tab.value === "Advanced" && isMap(document.value?.contents)) {
    const known = Object.values(sections).flat();
    keys.push(...document.value.contents.items.map(pair => String(pair.key?.value)).filter(key => !known.includes(key)));
  }
  return [...new Set(keys)].filter(key => key.toLowerCase().includes(search.value.toLowerCase()));
});
const tabs = [...Object.keys(sections), "YAML editor"];

function parse(sourceText) {
  document.value = parseDocument(sourceText, { merge: true, uniqueKeys: true });
  change.value++;
}
function edit(action) {
  if (!valid.value) return;
  try {
    action(document.value);
    source.value = document.value.toString();
    parse(source.value);
    notice.value = "";
    error.value = "";
  } catch {
    parse(source.value);
    error.value = "This change could not be represented safely. Use the YAML editor.";
  }
}
provide("editor", { document, change, drag, edit });

async function api(route, method = "GET", data) {
  const response = await fetch("api/" + route, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf.value },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (response.status === 401 && route !== "login") {
    authenticated.value = false;
    csrf.value = "";
  }
  if (!response.ok) throw new Error(result.error || "Request failed.");
  return result;
}
async function run(action) {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try { await action(); } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}
async function loadPages() {
  pages.value = (await api("pages")).pages;
  if (!pages.value.includes(page.value)) page.value = pages.value[0] || "config";
  if (pages.value.length) await load(page.value);
  else { source.value = saved.value = ""; revision.value = ""; parse(""); }
}
async function load(slug) {
  const result = await api("pages/" + encodeURIComponent(slug));
  page.value = slug;
  source.value = saved.value = result.source;
  revision.value = result.revision;
  parse(result.source);
  if (!valid.value) tab.value = "YAML editor";
}
async function login() {
  await run(async () => {
    const result = await api("login", "POST", { username: username.value, password: password.value });
    csrf.value = result.csrf;
    authenticated.value = true;
    await loadPages();
  });
  password.value = "";
}
function canDiscard() {
  return !dirty.value || window.confirm("Discard your unsaved changes?");
}
async function selectPage(event) {
  const target = event.target.value;
  event.target.value = page.value;
  if (!canDiscard()) return;
  await run(() => load(target));
}
async function save() {
  await run(async () => {
    const result = await api("pages/" + encodeURIComponent(page.value), "PUT", { source: source.value, revision: revision.value });
    saved.value = source.value = result.source;
    revision.value = result.revision;
    parse(source.value);
    notice.value = "Configuration saved. Reload the dashboard to see your changes.";
  });
}
async function createPage(duplicate = false) {
  if (!newPage.value.trim() || !canDiscard()) return;
  await run(async () => {
    const slug = newPage.value.trim();
    await api("pages", "POST", { slug, source: duplicate ? saved.value : "title: New page\nservices: []\n" });
    newPage.value = "";
    page.value = slug;
    await loadPages();
    notice.value = "Page created. Add a navigation link using #" + slug + " to open it from Homer.";
  });
}
async function deletePage() {
  if (!canDiscard() || !window.confirm("Delete page " + page.value + "? Existing navigation links must be updated manually.")) return;
  await run(async () => {
    await api("pages/" + encodeURIComponent(page.value), "DELETE", { revision: revision.value });
    page.value = "config";
    await loadPages();
    notice.value = "Page deleted.";
  });
}
function discard() {
  if (!canDiscard()) return;
  source.value = saved.value;
  parse(source.value);
  error.value = "";
}
function rawInput(event) {
  source.value = event.target.value;
  parse(source.value);
}
function download() {
  const url = URL.createObjectURL(new Blob([source.value], { type: "text/yaml" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = page.value + ".yml";
  link.click();
  URL.revokeObjectURL(url);
}
async function importFile(event) {
  const file = event.target.files[0];
  if (file && file.size <= 1024 * 1024 && canDiscard()) {
    source.value = await file.text();
    parse(source.value);
    tab.value = "YAML editor";
  } else if (file?.size > 1024 * 1024) error.value = "File exceeds 1 MiB.";
  event.target.value = "";
}
function beforeUnload(event) {
  if (dirty.value) { event.preventDefault(); event.returnValue = ""; }
}
async function logout() {
  if (!canDiscard()) return;
  await run(async () => {
    await api("logout", "POST", {});
    authenticated.value = false;
    csrf.value = source.value = saved.value = revision.value = "";
    document.value = null;
    pages.value = [];
  });
}
onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnload);
  await run(async () => {
    const status = await api("status");
    enabled.value = status.enabled;
    authenticated.value = status.authenticated;
    csrf.value = status.csrf || "";
    if (authenticated.value) await loadPages();
  });
});
onUnmounted(() => window.removeEventListener("beforeunload", beforeUnload));
const previewColors = computed(() => {
  const colors = config.value.colors?.[dark.value ? "dark" : "light"] || {};
  const safe = (key, fallback) => typeof colors[key] === "string" && CSS.supports("color", colors[key]) ? colors[key] : fallback;
  return { "--preview-bg": safe("background", dark.value ? "#171c24" : "#eef2f7"), "--preview-card": safe("card-background", dark.value ? "#2a3342" : "#ffffff"), "--preview-text": safe("text", dark.value ? "#eef2f7" : "#253047"), "--preview-primary": safe("highlight-primary", "#3367d6") };
});
</script>

<template>
  <main v-if="!authenticated" class="login-layout">
    <section class="login-card">
      <div class="brand"><i class="fas fa-house"></i> Homer</div>
      <h1>Administration</h1>
      <p class="muted">Manage your dashboard configuration.</p>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="enabled === false" class="alert">Administration is disabled. Configure ADMIN_USERNAME and ADMIN_PASSWORD on the server.</p>
      <form v-else-if="enabled === true" class="login-form" @submit.prevent="login">
        <label>Username<input v-model="username" autocomplete="username" required></label>
        <label>Password<input v-model="password" type="password" autocomplete="current-password" required></label>
        <button class="primary" :disabled="busy" type="submit">Sign in</button>
      </form>
      <p v-else-if="busy">Loading…</p>
      <p v-else>Management requires the Homer server. Static installations are read-only.</p>
      <a href="../">Back to dashboard</a>
    </section>
  </main>
  <div v-else class="admin-layout">
    <aside class="sidebar">
      <div class="brand"><i class="fas fa-house"></i> Homer <small>Admin</small></div>
      <nav aria-label="Settings">
        <button v-for="name in tabs" :key="name" :class="{ active: tab === name }" @click="tab = name; search = ''">{{ name }}</button>
      </nav>
      <div class="sidebar-bottom"><a href="../">Open dashboard</a><button @click="logout" :disabled="busy">Sign out</button></div>
    </aside>
    <main class="workspace">
      <header class="workspace-header">
        <div><h1>{{ tab }}</h1><p class="muted">Edit your local Homer configuration.</p></div>
        <button class="small-button" @click="preview = !preview">{{ preview ? "Hide preview" : "Preview" }}</button>
      </header>
      <section class="page-tools">
        <label>Configuration page<select :value="page" @change="selectPage" :disabled="busy"><option v-for="name in pages" :key="name" :value="name">{{ name === "config" ? "Main dashboard" : name }}</option></select></label>
        <label>New page slug<input v-model="newPage" placeholder="e.g. infrastructure"></label>
        <div class="toolbar"><button class="small-button" :disabled="busy || !newPage.trim()" @click="createPage(false)">Create</button><button class="small-button" :disabled="busy || !newPage.trim() || !pages.length" @click="createPage(true)">Duplicate</button><button v-if="page !== 'config'" class="small-button danger" :disabled="busy" @click="deletePage">Delete page</button></div>
      </section>
      <p v-if="page !== 'config'" class="alert">This page inherits the main configuration. Fields set here override the main page.</p>
      <p v-if="external" class="alert warning">External configuration is active. Homer follows that URL and ignores the remaining local fields. Only local YAML is editable here.</p>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <p v-if="notice" class="alert success" role="status">{{ notice }}</p>
      <p v-if="rawOnly && pages.length" class="alert warning">The YAML is invalid. Repair it in the YAML editor before using visual controls.</p>
      <section v-if="preview && pages.length" class="preview" :style="previewColors">
        <div class="preview-header"><strong>{{ config.title || "Dashboard" }}</strong><button class="small-button" @click="dark = !dark">{{ dark ? "Light" : "Dark" }}</button></div>
        <div class="preview-body">
          <p>{{ config.subtitle }}</p>
          <template v-for="(group, index) in (Array.isArray(config.services) ? config.services : [])" :key="index">
            <h3>{{ group?.name || "Services" }}</h3>
            <div class="preview-grid" :style="{ gridTemplateColumns: config.defaults?.layout === 'list' ? '1fr' : 'repeat(' + Math.min(6, Number(config.columns) || 3) + ', minmax(0, 1fr))' }">
              <div v-for="(item, idx) in (Array.isArray(group?.items) ? group.items : [])" :key="idx" class="preview-card"><i :class="item?.icon || 'fas fa-server'"></i><div><strong>{{ item?.name }}</strong><small>{{ item?.subtitle }}</small></div></div>
            </div>
          </template>
          <p class="muted small">Inert preview: no remote calls or HTML execution.</p>
        </div>
      </section>
      <section v-if="pages.length && (tab === 'YAML editor' || rawOnly)" class="editor-panel">
        <div class="toolbar"><button class="small-button" @click="download">Export YAML</button><label class="file-button">Import YAML<input type="file" accept=".yml,.yaml,text/yaml" @change="importFile"></label><button class="small-button" @click="run(async () => { await api('validate', 'POST', { source }); notice = 'YAML is valid.' })">Validate</button></div>
        <textarea class="yaml-editor" spellcheck="false" :value="source" aria-label="YAML configuration" @input="rawInput"></textarea>
        <p v-for="(issue, index) in document?.errors || []" :key="index" class="alert error">{{ issue.message }}</p>
      </section>
      <section v-else-if="pages.length" class="editor-panel">
        <input v-model="search" class="search" placeholder="Filter settings" aria-label="Filter settings">
        <p v-if="tab === 'Groups & cards' || tab === 'Advanced'" class="hint warning">Smart-card credentials stored in YAML are readable by dashboard visitors. Use read-only credentials or a trusted proxy.</p>
        <ConfigField v-for="key in fields" :key="page + ':' + key" :path="[key]" :spec="rootFields[key] || {}" />
      </section>
      <section v-else class="alert">No local configuration exists. Create a page named config to get started.</section>
      <datalist id="homer-icons"><option v-for="icon in iconOptions" :key="icon" :value="icon"></option></datalist>
      <footer class="save-bar">
        <span :class="dirty ? 'warning' : 'muted'">{{ dirty ? "Unsaved changes" : "All changes saved" }}</span>
        <div class="toolbar"><button class="small-button" :disabled="busy || !dirty" @click="discard">Discard</button><button class="primary" :disabled="busy || !dirty || !valid" @click="save">Save changes</button></div>
      </footer>
    </main>
  </div>
</template>
