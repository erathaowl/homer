// Remote message APIs are not trusted to execute code in the dashboard origin.
// Build a new tree from a small set of formatting elements and safe attributes.
const tags = new Set(["a", "abbr", "b", "blockquote", "br", "code", "dd", "div", "dl", "dt", "em", "h1", "h2", "h3", "h4", "hr", "i", "img", "li", "ol", "p", "pre", "s", "small", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]);
const blocked = new Set(["script", "style", "iframe", "object", "embed", "template", "svg", "math", "form", "link", "meta", "base"]);
function safeUrl(value, image = false) {
  try {
    const url = new URL(value, document.baseURI);
    return ["http:", "https:"].includes(url.protocol) || (!image && ["mailto:", "tel:"].includes(url.protocol));
  } catch { return false; }
}

export function sanitizeMessage(value) {
  if (typeof value !== "string") return "";
  const parsed = new DOMParser().parseFromString(value, "text/html");
  const output = document.createElement("div");
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    if (blocked.has(tag)) return;
    if (!tags.has(tag)) {
      for (const child of node.childNodes) copy(child, parent);
      return;
    }
    const element = document.createElement(tag);
    for (const name of ["class", "title", "alt", "width", "height", "colspan", "rowspan"]) {
      if (node.hasAttribute(name)) element.setAttribute(name, node.getAttribute(name));
    }
    if (tag === "a" && node.hasAttribute("href") && safeUrl(node.getAttribute("href"))) {
      element.setAttribute("href", node.getAttribute("href"));
      element.setAttribute("rel", "noopener noreferrer");
      if (node.getAttribute("target") === "_blank") element.setAttribute("target", "_blank");
    }
    if (tag === "img" && node.hasAttribute("src") && safeUrl(node.getAttribute("src"), true)) {
      element.setAttribute("src", node.getAttribute("src"));
      element.setAttribute("referrerpolicy", "no-referrer");
    }
    for (const child of node.childNodes) copy(child, element);
    parent.append(element);
  }
  for (const node of parsed.body.childNodes) copy(node, output);
  return output.innerHTML;
}
