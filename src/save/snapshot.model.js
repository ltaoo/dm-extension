// 由后台读取资源，避免页面 CORS 阻止已获主机权限的图片、字体归档。
export async function fetch_snapshot_resource(value, fetcher = fetch) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("不支持的资源地址");
  const response = await fetcher(url.href, { credentials: "include", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const limit = 8 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) throw new Error("资源超过 8 MB");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      bytes += chunk.length;
      if (bytes > limit) { await reader.cancel(); throw new Error("资源超过 8 MB"); }
      chunks.push(chunk);
    }
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  let binary = "";
  for (let index = 0; index < data.length; index += 32768) binary += String.fromCharCode(...data.subarray(index, index + 32768));
  const type = response.headers.get("content-type") || "application/octet-stream";
  return { data_url: `data:${type};base64,${btoa(binary)}`, bytes };
}

// scripting.executeScript 会序列化此函数；所有捕获逻辑必须自包含，且不修改原页面。
export async function capture_snapshot(screenshot = false) {
  const document_root = document.scrollingElement || document.documentElement;
  let capture_root = document_root;
  if (screenshot) {
    const score = (node, area) => area * (0.5 + Math.min(1, (node.scrollHeight - node.clientHeight) / node.clientHeight));
    let best_score = document_root.scrollHeight > document_root.clientHeight + 2 ? score(document_root, document.documentElement.clientWidth * document.documentElement.clientHeight) : 0;
    for (const node of document.querySelectorAll("*")) {
      if (node === document_root || node.scrollHeight <= node.clientHeight + 2 || !/^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) continue;
      if (node.closest("nav,aside,[role=navigation],[role=complementary]")) continue;
      const rect = node.getBoundingClientRect();
      let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
      let right = Math.min(innerWidth, rect.right), bottom = Math.min(innerHeight, rect.bottom);
      for (let parent = node.parentElement; parent && parent !== document_root; parent = parent.parentElement) {
        const css = getComputedStyle(parent), box = parent.getBoundingClientRect();
        if (css.overflowX !== "visible") { left = Math.max(left, box.left + parent.clientLeft); right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth); }
        if (css.overflowY !== "visible") { top = Math.max(top, box.top + parent.clientTop); bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight); }
      }
      if (right - left < Math.max(240, innerWidth * 0.3) || bottom - top < Math.max(160, innerHeight * 0.3)) continue;
      if (![0.3, 0.5, 0.7].some(part => node.contains(document.elementFromPoint(left + (right - left) * part, (top + bottom) / 2)))) continue;
      const candidate_score = score(node, (right - left) * (bottom - top)) * (node.closest("main,[role=main]") ? 1.25 : 1) * (left <= innerWidth / 2 && right >= innerWidth / 2 ? 1.2 : 1);
      if (candidate_score > best_score) { best_score = candidate_score; capture_root = node; }
    }
  }
  const whole_document = capture_root === document_root;
  const root_style = getComputedStyle(capture_root);
  const width = Math.ceil(capture_root.scrollWidth + (whole_document ? 0 : (parseFloat(root_style.borderLeftWidth) || 0) + (parseFloat(root_style.borderRightWidth) || 0)));
  const height = Math.ceil(capture_root.scrollHeight + (whole_document ? 0 : (parseFloat(root_style.borderTopWidth) || 0) + (parseFloat(root_style.borderBottomWidth) || 0)));
  const pixel_ratio = devicePixelRatio || 1;
  if (screenshot && (Math.round(width * pixel_ratio) > 32767 || Math.round(height * pixel_ratio) > 32767 || Math.round(width * pixel_ratio) * Math.round(height * pixel_ratio) > 64 * 1024 * 1024)) throw new Error("长截图超过图片尺寸限制，请缩小网页后重试");
  const started = Date.now();
  const warnings = new Set();
  const failed_resources = new Set();
  const resources = new Map();
  const styles = [];
  const style_ids = new Map();
  const scopes = [];
  const documents = [];
  const images = [];
  const fonts = new Map();
  const used_fonts = new Set();
  const visited_sheets = new Set();
  const runtime_fonts = new Set();
  let active = 0;
  const waiting = [];
  let total_bytes = 0;
  let elements = 0;
  let style_bytes = 0;
  const omitted = new Set(["HEAD", "SCRIPT", "NOSCRIPT", "STYLE", "LINK", "META", "BASE", "OBJECT", "EMBED", "APPLET", "PORTAL", "SOURCE", "TRACK", "TEMPLATE", "ANIMATE", "ANIMATEMOTION", "ANIMATETRANSFORM", "SET"]);
  const dropped = new Set(["style", "src", "srcset", "sizes", "href", "xlink:href", "poster", "srcdoc", "autofocus", "autoplay", "action", "formaction", "ping", "nonce", "integrity", "contenteditable", "background", "is"]);
  const url_pattern = () => /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|((?:\\.|[^)\\])*?))\s*\)/gi;
  const unescape_css = (value) => value.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex, char) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : char);

  function absolute(value, base) {
    try { return new URL(value, base).href; } catch { return ""; }
  }

  async function resource(url) {
    if (/^data:/i.test(url)) return url;
    if (resources.has(url)) return resources.get(url);
    if (resources.size >= 256) { failed_resources.add(url); return null; }
    const promise = (async () => {
      if (active < 6) active += 1;
      else await new Promise((resolve) => waiting.push(resolve));
      try {
        if (Date.now() - started > 60000) throw new Error("归档资源超时");
        let result;
        if (url.startsWith("blob:")) {
          const blob = await (await fetch(url)).blob();
          if (blob.size > 8 * 1024 * 1024) throw new Error("资源过大");
          const data_url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          result = { success: true, data_url, bytes: blob.size };
        } else {
          result = await chrome.runtime.sendMessage({ action: "snapshot-resource", url });
        }
        if (!result?.success || !result.data_url?.startsWith("data:") || !Number.isFinite(result.bytes)) throw new Error(result?.error || "读取资源失败");
        if (total_bytes + result.bytes > 64 * 1024 * 1024) throw new Error("归档资源超过 64 MB");
        total_bytes += result.bytes;
        return result.data_url;
      } catch {
        failed_resources.add(url);
        return null;
      } finally {
        const next = waiting.shift();
        if (next) next(); else active -= 1;
      }
    })();
    resources.set(url, promise);
    return promise;
  }

  function absolute_css(value, base) {
    return value.replace(url_pattern(), (whole, quoted, single, bare) => {
      const url = unescape_css(quoted ?? single ?? bare).trim();
      if (url.startsWith("#") || /^data:/i.test(url)) return whole;
      const resolved = absolute(url, base);
      if (resolved.includes("#") && resolved.split("#")[0] === base.split("#")[0]) return `url(${JSON.stringify(new URL(resolved).hash)})`;
      return `url(${JSON.stringify(resolved)})`;
    });
  }

  async function embed_css(css) {
    const replacements = [];
    for (const match of css.matchAll(url_pattern())) {
      const url = unescape_css(match[1] ?? match[2] ?? match[3]).trim();
      if (url.startsWith("#") || /^data:/i.test(url)) continue;
      replacements.push(resource(url).then((data) => [match[0], data ? `url(${JSON.stringify(data)})` : "none"]));
    }
    for (const [before, after] of await Promise.all(replacements)) css = css.replaceAll(before, after);
    return css;
  }

  function freeze_style(live, node, scope, pseudo) {
    const view = live.ownerDocument.defaultView;
    const computed = view.getComputedStyle(live, pseudo);
    for (const family of computed.fontFamily.split(",")) used_fonts.add(family.trim().replace(/^["']|["']$/g, "").toLowerCase());
    let css = "all:initial!important;";
    for (const name of computed) {
      if (name.startsWith("--") || /^(?:animation|transition|-webkit-animation|-webkit-transition)/.test(name)) continue;
      const value = computed.getPropertyValue(name);
      if (value) css += `${name}:${absolute_css(value, live.baseURI)}!important;`;
    }
    css += "animation:none!important;transition:none!important;caret-color:transparent!important;";
    let id = style_ids.get(css);
    if (id === undefined) {
      style_bytes += css.length;
      if (style_bytes > 24 * 1024 * 1024) throw new Error("页面样式过大，无法完整保存");
      id = styles.length;
      styles.push(css);
      style_ids.set(css, id);
    }
    scope.ids.add(id);
    node.setAttribute("data-dm-snapshot-style", String(id));
  }

  function pseudo_node(live, kind, scope) {
    const content = live.ownerDocument.defaultView.getComputedStyle(live, kind).content;
    if (!content || content === "none" || content === "normal") return null;
    const strings = [...content.matchAll(/"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'/g)];
    if (!strings.length || content.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "").trim()) {
      warnings.add("部分伪元素内容无法还原，保存结果可能缺失。");
      return null;
    }
    const node = scope.doc.createElement("span");
    node.setAttribute("data-n", kind === "::before" ? "snapshot-before" : "snapshot-after");
    node.textContent = strings.map((match) => unescape_css(match[1] ?? match[2])).join("");
    freeze_style(live, node, scope, kind);
    return node;
  }

  function build_node(live, scope, depth = 0) {
    if (live.nodeType === 3) return scope.doc.createTextNode(live.nodeValue);
    if (live.nodeType !== 1 || omitted.has(live.tagName.toUpperCase()) || (live.tagName === "INPUT" && live.type === "hidden")) return null;
    if (++elements > 12000 || depth > 300) throw new Error("页面内容过多，无法完整保存");
    let tag = live.localName;
    if (tag === "canvas" || tag === "video") tag = "img";
    if (screenshot && tag === "slot") tag = "span";
    if (["iframe", "frame", "audio"].includes(tag)) tag = "div";
    const node = scope.doc.createElementNS(live.namespaceURI, tag);
    for (const { name, value } of live.attributes) {
      if (dropped.has(name.toLowerCase()) || name.toLowerCase().startsWith("on") || name === "value" || name === "checked" || name === "selected") continue;
      try { node.setAttribute(name, value); } catch { /* 页面上无效的属性名不进入快照。 */ }
    }
    freeze_style(live, node, scope);
    if (screenshot) {
      node.style.setProperty("content-visibility", "visible", "important");
      const position = live.ownerDocument.defaultView.getComputedStyle(live).position;
      if (position === "fixed") node.style.setProperty("position", "absolute", "important");
      if (position === "sticky") {
        node.style.setProperty("position", "relative", "important");
        node.style.setProperty("inset", "auto", "important");
      }
    }
    if (live.tagName === "CANVAS" || live.tagName === "VIDEO") {
      try {
        let canvas = live;
        if (live.tagName === "VIDEO") {
          canvas = live.ownerDocument.createElement("canvas");
          canvas.width = live.videoWidth;
          canvas.height = live.videoHeight;
          canvas.getContext("2d").drawImage(live, 0, 0);
        }
        const data = canvas.toDataURL("image/png");
        if (data === "data:,") throw new Error("空画布");
        node.setAttribute("src", data);
      } catch { warnings.add("部分画布或视频画面无法读取，保存结果可能缺失。"); }
      return node;
    }
    if (live.tagName === "IMG") images.push({ node, name: "src", url: absolute(live.currentSrc || live.getAttribute("src") || "", live.baseURI) });
    if (live.namespaceURI === "http://www.w3.org/2000/svg") {
      const href = live.getAttribute("href") || live.getAttribute("xlink:href");
      if (href?.startsWith("#")) node.setAttribute("href", href);
      else if (href && live.localName === "image") images.push({ node, name: "href", url: absolute(href, live.baseURI) });
      else if (href && live.localName === "use") warnings.add("外部 SVG 引用未打包，保存结果可能缺失。");
    } else if (live.tagName === "A") {
      const original_href = live.getAttribute("href") || "";
      const href = absolute(original_href, live.baseURI);
      if (original_href.startsWith("#")) node.setAttribute("href", original_href);
      else if (/^(https?:|mailto:|tel:)/i.test(href)) { node.setAttribute("href", href); node.setAttribute("rel", "noreferrer noopener"); }
    }
    if (live.tagName === "IFRAME" || live.tagName === "FRAME") {
      try {
        if (!live.contentDocument?.documentElement) throw new Error("无法访问内嵌页面");
        if (screenshot) {
          const body = build_node(live.contentDocument.body, scope, depth + 1);
          if (body) node.append(body);
          node.style.setProperty("overflow", "hidden", "important");
          collect_fonts(live.contentDocument.styleSheets, live.contentDocument.baseURI);
          collect_fonts(live.contentDocument.adoptedStyleSheets, live.contentDocument.baseURI);
          for (const font of live.contentDocument.fonts || []) runtime_fonts.add(font.family.trim().replace(/^["']|["']$/g, "").toLowerCase());
          return node;
        }
        const frame_doc = build_document(live.contentDocument, depth + 1);
        const frame = scope.doc.createElement("iframe");
        frame.setAttribute("data-n", "snapshot-frame");
        frame.setAttribute("data-dm-snapshot-style", node.getAttribute("data-dm-snapshot-style"));
        documents.push({ node: frame, doc: frame_doc });
        return frame;
      } catch { warnings.add("部分内嵌页面无法读取，保存结果可能缺失。"); node.textContent = "内嵌页面未保存"; }
    }
    const before = pseudo_node(live, "::before", scope);
    if (before) node.append(before);
    if (screenshot && live.shadowRoot) {
      collect_fonts(live.shadowRoot.styleSheets, live.baseURI);
      collect_fonts(live.shadowRoot.adoptedStyleSheets, live.baseURI);
    }
    let children = screenshot && live.shadowRoot ? live.shadowRoot.childNodes : live.childNodes;
    if (screenshot && live.localName === "slot") {
      const assigned = live.assignedNodes({ flatten: true });
      if (assigned.length) children = assigned;
    }
    for (const child of children) {
      const cloned = build_node(child, scope, depth + 1);
      if (cloned) node.append(cloned);
    }
    const after = pseudo_node(live, "::after", scope);
    if (after) node.append(after);
    // shortcut: 关闭的 Shadow DOM 无法读取，需页面提供导出接口才能完整保存。
    if (live.shadowRoot && !screenshot) {
      const template = scope.doc.createElement("template");
      template.setAttribute("shadowrootmode", "open");
      template.setAttribute("data-n", "snapshot-shadow-root");
      const shadow_scope = { doc: scope.doc, root: template.content, ids: new Set() };
      scopes.push(shadow_scope);
      collect_fonts(live.shadowRoot.styleSheets, live.baseURI);
      collect_fonts(live.shadowRoot.adoptedStyleSheets, live.baseURI);
      for (const child of live.shadowRoot.childNodes) {
        const cloned = build_node(child, shadow_scope, depth + 1);
        if (cloned) template.content.append(cloned);
      }
      node.prepend(template);
    }
    if (live.tagName === "INPUT") {
      if (live.type !== "file") node.setAttribute("value", live.type === "password" ? "•".repeat(Math.min(live.value.length, 64)) : live.value);
      if (live.checked) node.setAttribute("checked", "");
    }
    if (live.tagName === "TEXTAREA") node.textContent = live.value;
    if (live.tagName === "OPTION" && live.selected) node.setAttribute("selected", "");
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(live.tagName)) node.setAttribute("disabled", "");
    return node;
  }

  const sheet_jobs = [];
  function font_rules(rules, base) {
    for (const rule of rules) {
      if (rule.type === 5) fonts.set(rule.cssText, { family: rule.style.getPropertyValue("font-family").trim().replace(/^["']|["']$/g, "").toLowerCase(), css: absolute_css(rule.cssText, base) });
      else if (rule.type === 3) collect_fonts([rule.styleSheet], rule.href);
      else if (rule.cssRules) font_rules(rule.cssRules, base);
    }
  }

  function collect_fonts(sheets, base) {
    for (const sheet of sheets || []) {
      if (!sheet || visited_sheets.has(sheet)) continue;
      visited_sheets.add(sheet);
      try { font_rules(sheet.cssRules, sheet.href || base); }
      catch { if (sheet.href) sheet_jobs.push(fetch_font_sheet(sheet.href)); }
    }
  }

  async function fetch_font_sheet(url) {
    if (visited_sheets.has(url)) return;
    visited_sheets.add(url);
    const data = await resource(url);
    if (!data) return;
    const css = await (await fetch(data)).text();
    const imports = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|"([^"]*)"|'([^']*)')[^;]*;/gi;
    const jobs = [];
    for (const match of css.matchAll(imports)) jobs.push(fetch_font_sheet(absolute(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5], url)));
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replace(imports, ""));
    font_rules(sheet.cssRules, url);
    await Promise.all(jobs);
  }

  function build_document(live_doc, depth = 0) {
    const doc = document.implementation.createHTMLDocument(live_doc.title);
    doc.documentElement.lang = live_doc.documentElement.lang;
    doc.head.innerHTML = "";
    const charset = doc.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    charset.setAttribute("data-n", "snapshot-charset");
    const policy = doc.createElement("meta");
    policy.setAttribute("http-equiv", "Content-Security-Policy");
    policy.setAttribute("content", "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; frame-src 'self' about:; form-action 'none'; base-uri 'none'");
    policy.setAttribute("data-n", "snapshot-policy");
    const title = doc.createElement("title");
    title.textContent = live_doc.title;
    title.setAttribute("data-n", "snapshot-title");
    doc.head.append(charset, policy, title);
    const scope = { doc, root: doc.head, ids: new Set() };
    scopes.push(scope);
    freeze_style(live_doc.documentElement, doc.documentElement, scope);
    const body = build_node(screenshot && !whole_document && live_doc === document ? capture_root : live_doc.body, scope, depth);
    if (!body) throw new Error("未获取到页面内容");
    if (body.localName === "body") doc.body.replaceWith(body);
    else doc.body.append(body);
    collect_fonts(live_doc.styleSheets, live_doc.baseURI);
    collect_fonts(live_doc.adoptedStyleSheets, live_doc.baseURI);
    for (const font of live_doc.fonts || []) runtime_fonts.add(font.family.trim().replace(/^["']|["']$/g, "").toLowerCase());
    return doc;
  }

  const doc = build_document(document);
  await Promise.all(sheet_jobs);
  const known_fonts = new Set([...fonts.values()].map(font => font.family));
  if ([...runtime_fonts].some(font => used_fonts.has(font) && !known_fonts.has(font))) warnings.add("部分动态字体无法读取，可使用截图保留当前外观。");
  const embedded_styles = await Promise.all(styles.map(embed_css));
  const embedded_fonts = await Promise.all([...fonts.values()].filter((font) => used_fonts.has(font.family)).map((font) => embed_css(font.css)));
  await Promise.all(images.map(async ({ node, name, url }) => {
    if (!url) return;
    const data = await resource(url);
    if (data) node.setAttribute(name, data);
  }));
  for (const scope of scopes) {
    const style = scope.doc.createElement("style");
    style.setAttribute("data-n", "snapshot-styles");
    style.textContent = (embedded_fonts.join("\n") + [...scope.ids].map((id) => `[data-dm-snapshot-style="${id}"]{${embedded_styles[id]}}`).join("\n")).replace(/</g, "\\3c ");
    scope.root.append(style);
  }
  for (const frame of documents) frame.node.setAttribute("srcdoc", "<!doctype html>\n" + frame.doc.documentElement.outerHTML);
  if (failed_resources.size) warnings.add(`${failed_resources.size} 个资源未能打包，离线打开时相应图片或字体可能缺失。`);
  if (screenshot) {
    const root = whole_document ? doc.documentElement : doc.body.firstElementChild;
    for (const [property, value] of Object.entries({ position: "relative", inset: "auto", width: `${width}px`, height: `${height}px`, "box-sizing": "border-box", "max-width": "none", "max-height": "none", "min-width": "0", "min-height": "0", margin: "0", overflow: "visible", transform: "none", contain: "none" })) root.style.setProperty(property, value, "important");
    if (!whole_document) {
      doc.documentElement.removeAttribute("data-dm-snapshot-style");
      doc.body.style.margin = "0";
    } else {
      doc.body.style.setProperty("overflow", "visible", "important");
    }
    let background_color = "white";
    for (let node = capture_root; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") { background_color = color; break; }
    }
    const markup = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
    if (new TextEncoder().encode(svg).length > 96 * 1024 * 1024) throw new Error("截图内容过大，无法完整渲染");
    // shortcut: SVG 只能绘制当前已有 DOM，虚拟列表、关闭的 Shadow DOM 和跨域 iframe 需要专用捕获。
    return { svg, width, height, pixel_ratio, background_color, title: document.title, warnings: [...warnings] };
  }
  const html = "<!doctype html>\n" + doc.documentElement.outerHTML;
  if (new TextEncoder().encode(html).length > 96 * 1024 * 1024) throw new Error("归档文件过大，无法完整保存");
  return { html, title: document.title, warnings: [...warnings], stats: { elements, resources: resources.size, failed: failed_resources.size } };
}
