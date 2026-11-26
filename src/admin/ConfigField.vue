<script setup>
import { computed, inject, ref } from "vue";
import { isAlias, isMap, isScalar, isSeq } from "yaml";
import { initialValue, labelFor, resolveSchema } from "./schema.js";

const props = defineProps({
  path: { type: Array, required: true },
  spec: { type: Object, default: () => ({}) },
  label: { type: String, default: "" },
  removable: { type: Boolean, default: true },
});
const editor = inject("editor");
const node = computed(() => editor.document.value?.getIn(props.path, true));
const value = computed(() => {
  editor.change.value;
  if (!node.value) return undefined;
  try { return node.value.toJSON(); } catch { return undefined; }
});
const exists = computed(() => { editor.change.value; return editor.document.value?.hasIn(props.path); });
const config = computed(() => resolveSchema(props.spec, value.value, props.path.at(-1)));
const title = computed(() => props.label || labelFor(props.path.at(-1)));
const fields = computed(() => [...new Set([...Object.keys(config.value.properties || {}), ...(isMap(node.value) ? node.value.items.map(pair => String(pair.key?.value)) : [])])]);
const isProtected = computed(() => {
  editor.change.value;
  return props.path.some((_, index) => {
    const current = editor.document.value?.getIn(props.path.slice(0, index + 1), true);
    return isAlias(current) || (isMap(current) && current.items.some(pair => String(pair.key?.value) === "<<"));
  });
});
const children = computed(() => { editor.change.value; return isSeq(node.value) ? node.value.items : []; });
const newKey = ref("");
const show = ref(true);
const revealed = ref(false);
const enumValues = computed(() => config.value.enum || []);
const currentText = computed(() => value.value == null ? "" : String(value.value));
const isHex = computed(() => /^#[0-9a-f]{6}$/i.test(currentText.value));
const arrayChoices = computed(() => resolveSchema(config.value.items || {}).enum);
const isCollection = computed(() => isMap(node.value) || isSeq(node.value));
const iconOptions = ["fas fa-server", "fas fa-globe", "fas fa-home", "fas fa-network-wired", "fas fa-database", "fas fa-shield-halved", "fas fa-cloud", "fas fa-code", "fas fa-book", "fas fa-heartbeat", "fab fa-github", "fab fa-gitlab", "fab fa-docker", "fab fa-linux"];

function set(next) {
  editor.edit(doc => doc.setIn(props.path, next));
}
function remove() {
  if (isCollection.value && !window.confirm("Remove " + title.value + " and its contents?")) return;
  editor.edit(doc => doc.deleteIn(props.path));
}
function addKey() {
  const key = newKey.value.trim();
  if (!key || ["__proto__", "constructor", "prototype", "<<"].includes(key) || fields.value.includes(key)) return;
  editor.edit(doc => doc.setIn([...props.path, key], ""));
  newKey.value = "";
}
function append() {
  editor.edit(doc => doc.getIn(props.path, true).add(initialValue(config.value.items)));
}
function move(from, to) {
  if (to < 0 || to >= children.value.length || from === to) return;
  editor.edit(doc => {
    const sequence = doc.getIn(props.path, true);
    sequence.items.splice(to, 0, sequence.items.splice(from, 1)[0]);
  });
}
function drag(event, index) {
  editor.drag.value = { path: [...props.path], index, kind: config.value.items?.$ref || "" };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", "homer-config-item");
}
function drop(index) {
  const from = editor.drag.value;
  editor.drag.value = null;
  if (!from) return;
  const same = JSON.stringify(from.path) === JSON.stringify(props.path);
  if (same) return move(from.index, Math.min(index, children.value.length - 1));
  if (from.kind !== "#/definitions/Item" || config.value.items?.$ref !== from.kind) return;
  editor.edit(doc => {
    const source = doc.getIn(from.path, true);
    const target = doc.getIn(props.path, true);
    if (!isSeq(source) || !isSeq(target)) return;
    target.items.splice(index, 0, source.items.splice(from.index, 1)[0]);
  });
}
function selectEnum(event) {
  const selected = enumValues.value.find(option => String(option) === event.target.value);
  set(selected ?? event.target.value);
}
function toggleChoice(option, checked) {
  const current = Array.isArray(value.value) ? [...value.value] : [];
  set(checked ? [...current, option] : current.filter(v => v !== option));
}
function toggleToken(option, checked) {
  const current = currentText.value.split(/\s+/).filter(Boolean);
  set((checked ? [...new Set([...current, option])] : current.filter(v => v !== option)).join(" "));
}
function childLabel(child, index) {
  if (isMap(child)) return child.get("name") || child.get("title") || "Item " + (index + 1);
  if (isScalar(child)) return "Value " + (index + 1);
  return "Item " + (index + 1);
}
</script>

<template>
  <section class="config-field" :class="{ collection: isCollection }">
    <div class="field-heading">
      <button v-if="isCollection" type="button" class="plain" @click="show = !show" :aria-expanded="show">
        <i :class="show ? 'fas fa-chevron-down' : 'fas fa-chevron-right'"></i>
        <strong>{{ title }}</strong>
      </button>
      <strong v-else>{{ title }}</strong>
      <span class="spacer"></span>
      <span v-if="!exists" class="muted small">Inherited / unset</span>
      <button v-if="!exists && !isProtected" type="button" class="small-button" @click="set(initialValue(spec))">Set</button>
      <button v-else-if="removable && !isProtected" type="button" class="small-button danger" @click="remove">Remove</button>
    </div>
    <p v-if="config.description" class="hint">{{ config.description }}</p>
    <p v-if="isProtected" class="hint warning">This field contains a YAML alias or merge key. Use the YAML editor to modify it safely.</p>
    <template v-else-if="exists && (!isCollection || show)">
      <template v-if="value === null">
        <button type="button" class="small-button" @click="set(initialValue(spec))">Replace null</button>
      </template>
      <template v-else-if="isMap(node)">
        <div class="nested-fields">
          <ConfigField v-for="key in fields" :key="key" :path="[...path, key]" :spec="config.properties?.[key] || (typeof config.additionalProperties === 'object' ? config.additionalProperties : {})" />
          <form class="inline-form" @submit.prevent="addKey">
            <input v-model="newKey" placeholder="Custom YAML key" aria-label="Custom YAML key">
            <button type="submit" class="small-button" :disabled="!newKey.trim()">Add field</button>
          </form>
        </div>
      </template>
      <template v-else-if="isSeq(node)">
        <div v-if="arrayChoices?.length" class="choice-grid">
          <label v-for="option in arrayChoices" :key="option"><input type="checkbox" :checked="value?.includes(option)" @change="toggleChoice(option, $event.target.checked)"> {{ option }}</label>
        </div>
        <div class="sequence">
          <article v-for="(child, index) in children" :key="index" class="sequence-row" @dragover.prevent @drop.stop.prevent="drop(index)">
            <div class="sequence-controls">
              <span class="drag-handle" draggable="true" @dragstart="drag($event, index)" @dragend="editor.drag.value = null" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
              <span class="spacer"></span>
              <button type="button" class="small-button" :disabled="index === 0" @click="move(index, index - 1)" aria-label="Move up">↑</button>
              <button type="button" class="small-button" :disabled="index === children.length - 1" @click="move(index, index + 1)" aria-label="Move down">↓</button>
            </div>
            <ConfigField :path="[...path, index]" :spec="config.items || {}" :label="String(childLabel(child, index))" />
          </article>
          <div class="drop-zone" @dragover.prevent @drop.stop.prevent="drop(children.length)">
            <button type="button" class="small-button" @click="append"><i class="fas fa-plus"></i> Add item</button>
          </div>
        </div>
      </template>
      <template v-else-if="config.tokens">
        <div class="choice-grid"><label v-for="option in config.tokens" :key="option"><input type="checkbox" :checked="currentText.split(/\s+/).includes(option)" @change="toggleToken(option, $event.target.checked)"> {{ option }}</label></div>
        <input :value="currentText" :aria-label="title" @change="set($event.target.value)">
      </template>
      <template v-else-if="enumValues.length">
        <select :value="currentText" :aria-label="title" @change="selectEnum">
          <option v-if="!enumValues.some(v => String(v) === currentText)" :value="currentText">{{ currentText }} (custom)</option>
          <option v-for="option in enumValues" :key="option" :value="String(option)">{{ option }}</option>
        </select>
      </template>
      <template v-else-if="config.color">
        <div class="color-row">
          <input type="color" :value="isHex ? currentText : '#3367d6'" :aria-label="title + ' color picker'" @input="set($event.target.value)">
          <input :value="currentText" :aria-label="title" placeholder="#3367d6 or CSS color" @change="set($event.target.value)">
        </div>
      </template>
      <template v-else-if="Array.isArray(config.type)">
        <select v-if="config.type.includes('boolean')" :aria-label="title + ' mode'" :value="typeof value === 'boolean' ? String(value) : 'custom'" @change="set($event.target.value === 'custom' ? (config.type.includes('integer') ? 30000 : '') : $event.target.value === 'true')">
          <option value="false">Disabled / false</option><option value="true">Enabled / true</option><option value="custom">Custom value</option>
        </select>
        <textarea v-if="typeof value === 'string'" :value="value" :aria-label="title" rows="3" @change="set($event.target.value)"></textarea>
        <input v-else-if="typeof value === 'number'" type="number" :value="value" :aria-label="title" @change="set(Number($event.target.value))">
      </template>
      <label v-else-if="config.type === 'boolean'" class="toggle"><input type="checkbox" :checked="value === true" @change="set($event.target.checked)"> {{ value ? "Enabled" : "Disabled" }}</label>
      <input v-else-if="config.type === 'integer'" type="number" :aria-label="title" :value="value" @change="set(Number($event.target.value))">
      <textarea v-else-if="config.multiline" rows="4" :value="currentText" :aria-label="title" @change="set($event.target.value)"></textarea>
      <div v-else-if="config.secret || /password|token|apikey|auth$/i.test(String(path.at(-1)))" class="color-row">
        <input :type="revealed ? 'text' : 'password'" :value="currentText" :aria-label="title" autocomplete="off" @change="set($event.target.value)">
        <button type="button" class="small-button" @click="revealed = !revealed">{{ revealed ? "Hide" : "Show" }}</button>
      </div>
      <div v-else-if="path.at(-1) === 'icon'" class="color-row">
        <i :class="currentText" class="icon-preview"></i>
        <input :value="currentText" :aria-label="title" list="homer-icons" placeholder="fas fa-server" @change="set($event.target.value)">
      </div>
      <input v-else :value="currentText" :aria-label="title" @change="set($event.target.value)">
    </template>
    <datalist v-if="path.at(-1) === 'icon'" id="homer-icons"><option v-for="icon in iconOptions" :key="icon" :value="icon"></option></datalist>
  </section>
</template>
