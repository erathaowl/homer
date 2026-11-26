import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../node_modules/@fortawesome/fontawesome-free/", import.meta.url));

export function iconCatalog(root = packageRoot) {
  const options = [];
  for (const [style, prefix] of [["solid", "fas"], ["regular", "far"], ["brands", "fab"]]) {
    const directory = ["svgs", "svg"].map(folder => path.join(root, folder, style))
      .find(folder => fs.existsSync(folder));
    if (directory) {
      for (const file of fs.readdirSync(directory)) {
        if (file.endsWith(".svg")) options.push(prefix + " fa-" + file.slice(0, -4));
      }
    } else {
      // The distributed JS bundles contain the same icon names as the webfonts.
      const source = fs.readFileSync(path.join(root, "js", style + ".js"), "utf8");
      for (const match of source.matchAll(/["']?([a-z0-9][a-z0-9-]*)["']?\s*:\s*\[\s*\d+\s*,\s*\d+\s*,\s*\[/g)) {
        options.push(prefix + " fa-" + match[1]);
      }
    }
  }
  return [...new Set(options)].sort();
}
