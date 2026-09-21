// 区域剪藏模型。
//
// 目标：把实时页面上选中的节点冻结成一段「纯内联、零外部引用」的 HTML，放进任意宿主文档
// 都能显示成原样 —— 不引脚本、不引样式表、不引图片、不支持交互。
//
// 样式策略（关键，别再重新推导）：不复制任何 <style>/<link>（选择器是全局的，会污染宿主；
// class 又常是哈希、跨快照不稳），而是把 getComputedStyle 的 used value 逐元素写进 style 属性，
// 等于给选区拍一张「布局已结算」的静态快照。哪些属性必须写，由「初始值表 + 继承表」决定：
//   · 非继承属性：与初始值不同才写（初始值由挂在页面上的 all:initial 探针一次读出）
//   · 继承属性：与父元素的计算值不同才写（根节点按「父 = all:initial」处理，走同一条代码路径）
//   · 拿不准的一律按非继承处理：多写无害、漏写会错（父子都是 position:absolute 时，
//     只比父会把子判定成「相同」而漏写 → 子节点定位丢失）
// 每个元素都先写 `all:unset`，外层再包一层 all:initial，每条声明带 !important：
// 宿主的任何选择器（连 `*{box-sizing:border-box}`、`*{...!important}` 这种）都改不动我们没写出来的属性。
//
// 注入约定：extract_clip / clip_region 会被 scripting.executeScript({ func }) 序列化进页面，
// 必须自包含（不引用模块作用域），因此里面各留了一份 node_label / identify_container 的同源实现。

import { hostname_of } from "../compare/detection.model.js";

export const clips_key = "region-clips";
export const clip_options_key = "clip-options";

// 剪藏条目上限：每条的 html 可能几 MB，别让 storage 无限膨胀。
export const MAX_CLIP_RECORDS = 100;

// 选择器在页面上留下的临时标记（代替「hostname + 选择器」的定位方式，省掉三份选择器算法）。
export const CLIP_MARKER = "data-dm-clip-target";

export const default_clip_options = () => ({ important: true, inline_images: true, materialize_pseudo: true });

export function normalize_clip_options(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return default_clip_options();
  return {
    important: value.important !== false,
    inline_images: value.inline_images !== false,
    materialize_pseudo: value.materialize_pseudo !== false,
  };
}

// 产出物的硬性自检：命中任意一条即视为「引入了外部资源 / 可执行内容」。
// 结果页、SW 落库前、测试断言都用它。
export function verify_no_external_refs(html) {
  const text = String(html || "");
  const patterns = [
    ["外链 url()", /url\(\s*['"]?\s*(?:https?:)?\/\//i],
    ["外链 src", /(?:^|[\s"'<>])src\s*=\s*["']?\s*(?:https?:)?\/\//i],
    ["外链 href", /(?:^|[\s"'<>])(?:xlink:)?href\s*=\s*["']?\s*(?:https?:)?\/\//i],
    ["srcset", /(?:^|[\s"'<>])srcset\s*=/i],
    ["@import", /@import/i],
    ["script 标签", /<\s*script\b/i],
    ["资源/嵌入式标签", /<\s*(?:style|link|iframe|object|embed|base|noscript|template|audio|video|source|track)\b/i],
    ["内联事件", /<\s*[a-zA-Z][^<>]*\s+on[a-z]+\s*=/],
  ];
  const hits = [];
  for (const [label, pattern] of patterns) {
    const match = pattern.exec(text);
    if (match) hits.push({ label, sample: text.slice(Math.max(0, match.index - 20), match.index + 60) });
  }
  return { ok: hits.length === 0, hits };
}

function escape_html(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 剪藏记录的加载归一：丢弃没有 id / 没有 html 的坏数据，按时间倒序（新的在前）。
export function normalize_clip_records(list) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const html = typeof item.html === "string" ? item.html : "";
    if (!id || !html || seen.has(id)) continue;
    seen.add(id);
    const url = typeof item.url === "string" ? item.url : "";
    result.push({
      id,
      url,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : (url || "未命名剪藏"),
      node: typeof item.node === "string" ? item.node : "",
      hostname: typeof item.hostname === "string" ? item.hostname : hostname_of(url),
      html,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      element_count: Number(item.element_count) || 0,
      image_count: Number(item.image_count) || 0,
      image_missing: Number(item.image_missing) || 0,
      byte_size: Number(item.byte_size) || 0,
      options: normalize_clip_options(item.options),
      created_at: Number(item.created_at) || 0,
    });
  }
  return result.sort((a, b) => b.created_at - a.created_at);
}

// 片段本身可直接嵌进任意 HTML；full = true 时补成一份完整文档（body 的 margin 用内联样式清零，
// 不引 <style>，自检要求产出物里没有 style 标签）。
export function build_clip_document(record, { full = false } = {}) {
  const fragment = String(record?.html || "");
  if (!full) return fragment;
  const title = escape_html(record?.title || "剪藏片段");
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + `<title>${title}</title>\n</head>\n<body style="margin:0">\n${fragment}\n</body>\n</html>`;
}

// 给片段最外层元素定尺寸（结果页用）：提取时刻意不冻结宽高（见 apply_diff），
// 尺寸在这里按需补上——写在 style 属性末尾，靠「后写的同属性声明获胜」压过属性里可能已有的宽高。
// 宽高任一为空 = 那一维交给宿主（宽度自适应）。
// 必须用文本拼 style 属性：走 CSSOM 的话，属性里开头的 `all:initial` 会被展开成几百条 longhand。
export function size_clip_fragment(html, width, height) {
  const text = String(html || "");
  const px = (value) => {
    const num = Math.round(Number(value));
    return Number.isFinite(num) && num > 0 ? `${num}px!important` : "";
  };
  const declarations = [];
  const w = px(width);
  const h = px(height);
  if (w) declarations.push(`width:${w}`);
  if (h) declarations.push(`height:${h}`);
  if (!declarations.length) return text;
  const parsed = new DOMParser().parseFromString(text, "text/html");
  const outer = parsed.body.firstElementChild;
  if (!outer) return text;
  const style = (outer.getAttribute("style") || "").replace(/\s*;\s*$/, "");
  outer.setAttribute("style", style ? `${style};${declarations.join(";")}` : declarations.join(";"));
  return outer.outerHTML;
}

// 在页面上下文中执行：按标记找到选中节点，冻结成自包含片段。
// 必须自包含（不引用模块作用域），因为要被 scripting.executeScript({ func }) 序列化注入页面。
export async function extract_clip(uuid, options) {
  const MARKER = "data-dm-clip-target";
  const MAX_ELEMENTS = 6000;
  const MAX_DEPTH = 400;
  const MAX_IMAGES = 60;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
  const PLACEHOLDER_IMAGE = "repeating-linear-gradient(45deg,#e9ecef 0 6px,#f8f9fa 6px 12px)";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  const opts = options && typeof options === "object" ? options : {};
  const IMPORTANT = opts.important !== false;
  const INLINE_IMAGES = opts.inline_images !== false;
  const MATERIALIZE_PSEUDO = opts.materialize_pseudo !== false;
  const PRIORITY = IMPORTANT ? "important" : "";

  const doc = document;
  const view = window;

  function fail(message) { return { ok: false, error: message }; }

  // 元素外框文字（仅用于界面）：与 detection.model.js 的 node_label 同一套语汇。
  function label_of(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) return `${tag}#${element.id}`;
    const name = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean)[0] : "";
    return name ? `${tag}.${name}` : tag;
  }

  // —— 0) 找到被选中的节点 ——
  let target = null;
  const marked = doc.querySelectorAll(`[${MARKER}]`);
  for (let index = 0; index < marked.length; index += 1) {
    if (marked[index].getAttribute(MARKER) === uuid) { target = marked[index]; break; }
  }
  if (target) target.removeAttribute(MARKER);
  if (!target) return fail("未找到选中的节点（页面可能已刷新或跳转）");

  // —— 1) 探针：一次读出「属性全集 + 每个属性的初始值」——
  // all:initial 的内联 !important 高于任何作者样式表，所以这份初始值可信。
  // 探针必须挂在文档上（游离节点读不到计算样式），读完立刻移除，冻结阶段读到的才是未被改动的页面。
  const probe = doc.createElement("div");
  probe.setAttribute("style", "all:initial!important");
  doc.documentElement.appendChild(probe);
  const NAMES = [];
  const INITIAL = [];
  let probe_style = null;
  try {
    probe_style = view.getComputedStyle(probe);
    for (let index = 0; index < probe_style.length; index += 1) {
      const name = probe_style.item(index);
      // 自定义属性不冻结（used value 已经是结算后的结果），all 也不改它们。
      if (!name || name.lastIndexOf("--", 0) === 0) continue;
      NAMES.push(name);
      INITIAL.push(probe_style.getPropertyValue(name));
    }
  } finally {
    probe.remove();
  }
  if (!NAMES.length) return fail("无法读取初始样式（页面可能已卸载）");

  // all 不改 direction，探针读到的是继承来的值（页面可能整体 RTL）—— 归到继承组并钉成真实初始值。
  // unicode-bidi 同理不受 all 影响，但探针的值就是浏览器真初始值（"isolate"），不用改。
  {
    const index = NAMES.indexOf("direction");
    if (index >= 0) INITIAL[index] = "ltr";
    else { NAMES.push("direction"); INITIAL.push("ltr"); }
  }

  const INDEX = new Map();
  for (let index = 0; index < NAMES.length; index += 1) INDEX.set(NAMES[index], index);

  function at(values, name) {
    const index = INDEX.get(name);
    return index === undefined ? "" : values[index];
  }

  // 继承属性表。只列「确定继承」的：拿不准的一律不列（按非继承处理 → 多写，安全）。
  const INHERITED = new Set([
    "color", "direction", "unicode-bidi", "visibility", "opacity", "pointer-events",
    "font", "font-family", "font-size", "font-size-adjust", "font-style", "font-stretch", "font-weight",
    "font-feature-settings", "font-variation-settings", "font-kerning", "font-optical-sizing", "font-palette",
    "font-synthesis", "font-variant", "font-variant-alternates", "font-variant-caps", "font-variant-east-asian",
    "font-variant-emoji", "font-variant-ligatures", "font-variant-numeric", "font-variant-position",
    "letter-spacing", "line-height", "line-break", "hyphens", "word-break", "word-spacing", "overflow-wrap",
    "tab-size", "text-align", "text-align-last", "text-indent", "text-justify", "text-transform", "text-shadow",
    "text-orientation", "text-rendering", "text-combine-upright", "text-emphasis", "text-emphasis-color",
    "text-emphasis-position", "text-emphasis-style", "text-underline-offset", "text-underline-position",
    "text-decoration-skip-ink", "white-space", "writing-mode", "quotes", "orphans", "widows", "caret-color",
    "list-style", "list-style-image", "list-style-position", "list-style-type",
    "caption-side", "border-collapse", "border-spacing", "empty-cells",
    "color-scheme", "accent-color", "forced-color-adjust", "print-color-adjust", "image-rendering",
    "ruby-align", "ruby-position", "math-style", "math-depth",
    "-webkit-font-smoothing", "-webkit-text-size-adjust", "-webkit-text-fill-color", "-webkit-text-stroke-color",
    "-webkit-text-stroke-width",
    // SVG 的继承属性（图标/图形都靠它们）
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity", "stroke-width", "stroke-dasharray",
    "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "paint-order", "clip-rule",
    "marker", "marker-start", "marker-mid", "marker-end", "shape-rendering", "text-anchor", "dominant-baseline",
  ]);
  const INHERITED_INDEX = new Set();
  for (let index = 0; index < NAMES.length; index += 1) {
    if (INHERITED.has(NAMES[index])) INHERITED_INDEX.add(index);
  }

  function read_all(style) {
    const out = new Array(NAMES.length);
    for (let index = 0; index < NAMES.length; index += 1) {
      let value = "";
      try { value = style.getPropertyValue(NAMES[index]) || ""; } catch (error) { value = ""; }
      out[index] = value;
    }
    return out;
  }

  // 不写的属性：content 对普通元素无效（只走伪元素实体化）；transition/animation 一律清空；
  // cursor 是交互暗示；其余是噪声。
  function skip_property(name) {
    if (name === "content" || name === "cursor" || name === "will-change" || name === "all" || name === "-webkit-locale") return true;
    if (name.lastIndexOf("transition", 0) === 0 || name.lastIndexOf("animation", 0) === 0) return true;
    if (name.lastIndexOf("-webkit-transition", 0) === 0 || name.lastIndexOf("-webkit-animation", 0) === 0) return true;
    return false;
  }

  // 「门没开，属性就是惰性的」：写了也没有视觉效果，而它们的计算值往往已被解析成像素 / currentColor，
  // 与初始值不同 → 会白白写进每个元素（边框色、轮廓色、背景位置、变换原点都是这一类）。
  function is_inert(name, values) {
    if (name.length > 6 && name.slice(-6) === "-color") {
      if (name === "text-decoration-color") return at(values, "text-decoration-line") === "none";
      const style_name = `${name.slice(0, -6)}-style`;
      // -webkit-text-fill-color 之类没有同名 -style 的属性不受影响。
      return INDEX.has(style_name) && at(values, style_name) === "none";
    }
    if (name.lastIndexOf("border-image-", 0) === 0) return at(values, "border-image-source") === "none";
    if (name.lastIndexOf("transform-origin", 0) === 0) return at(values, "transform") === "none";
    if (name.lastIndexOf("perspective-origin", 0) === 0) return at(values, "perspective") === "none";
    if (name.lastIndexOf("background-position", 0) === 0 || name.lastIndexOf("background-repeat", 0) === 0) return at(values, "background-image") === "none";
    if (name === "background-size" || name === "background-origin") return at(values, "background-image") === "none";
    return false;
  }

  const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong"]);

  // 字体不复制样式表也不会加载，自定义字体会落到后面的兜底族名上；末尾不是通用族名就补一个。
  function with_fallback(value) {
    const text = String(value).trim();
    if (!text) return text;
    const parts = text.split(",");
    const last = parts[parts.length - 1].trim().replace(/^["']|["']$/g, "").toLowerCase();
    return GENERIC_FAMILIES.has(last) ? text : `${text}, sans-serif`;
  }

  function url_re() { return /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi; }
  function has_url(value) { return /url\(/i.test(value); }
  function is_fetchable(url) { return /^(?:https?:)?\/\//i.test(url); }

  // —— 2) 冻结：把 live 子树按「计算样式差分」写进新建的游离节点 ——
  const declarations = [];   // 含 url() 的声明，等资源解析完再落地；解析失败就整条丢弃
  const images = [];         // <img>：解析成功写回 src，失败退化为占位块
  const urls = new Set();
  let element_count = 0;
  let image_missing = 0;

  function set_declaration(node, name, value) {
    if (!has_url(value)) {
      try { node.style.setProperty(name, value, PRIORITY); } catch (error) { /* 浏览器拒绝的非法值直接忽略 */ }
      return;
    }
    const found = [];
    const pattern = url_re();
    let match = pattern.exec(value);
    while (match) {
      if (is_fetchable(match[2])) { found.push(match[2]); urls.add(match[2]); }
      match = pattern.exec(value);
    }
    declarations.push({ node, name, value, urls: found });
  }

  function force_declaration(node, name, value) {
    try { node.style.setProperty(name, value, "important"); } catch (error) { /* 忽略 */ }
  }

  function apply_diff(node, values, parent_values, is_root) {
    for (let index = 0; index < NAMES.length; index += 1) {
      const name = NAMES[index];
      if (skip_property(name) || is_inert(name, values)) continue;
      // 最外层不冻结宽高：冻上了就被钉死在抓取时的尺寸里，放哪儿都改不了。
      // 尺寸交给结果页按需写入（见 size_clip_fragment），不给就随宿主自适应。
      if (is_root && (name === "width" || name === "height")) continue;
      let value = values[index];
      if (!value) continue;
      // 非继承属性一律对着初始值比；继承属性对着父的计算值比（根节点的父 = all:initial 的包裹层）。
      const reference = INHERITED_INDEX.has(index) ? (is_root ? INITIAL[index] : parent_values[index]) : INITIAL[index];
      if (value === reference) continue;
      if (name === "font-family") value = with_fallback(value);
      set_declaration(node, name, value);
    }
    // fixed/sticky 在宿主里会以宿主视口为参照，必须降级掉。
    const position = at(values, "position");
    if (position === "fixed") force_declaration(node, "position", is_root ? "relative" : "absolute");
    else if (position === "sticky" && is_root) force_declaration(node, "position", "relative");
    if (at(values, "background-attachment") === "fixed") force_declaration(node, "background-attachment", "scroll");
    if (at(values, "transition-duration").split(",").some((part) => parseFloat(part) > 0)) force_declaration(node, "transition", "none");
    // 只写 animation-name：写 animation 简写时 CSSOM 会把它展开成一长串默认值序列化回来。
    const animation = at(values, "animation-name");
    if (animation && animation !== "none") force_declaration(node, "animation-name", "none");
  }

  // 不进入产出物的标签：脚本 / 样式表 / 嵌入式内容 / 只引资源的元素。
  const IGNORE_TAGS = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "LINK", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "APPLET", "BASE", "META", "PARAM", "SOURCE", "TRACK", "VIDEO", "AUDIO", "PORTAL", "HEAD"]);
  // 不拷的属性：交互入口（href/tabindex/事件）、可能触发加载的（srcset/poster）、我们自己重建的（class/style）。
  const DROP_ATTRS = new Set(["class", "style", "src", "srcset", "sizes", "target", "tabindex", "contenteditable", "draggable", "spellcheck", "autocapitalize", "autofocus", "ping", "rel", "download", "nonce", "integrity", "crossorigin", "referrerpolicy", "loading", "decoding", "poster", "media", "action", "method", "enctype", "formaction", "formmethod", "srcdoc"]);
  const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION", "OPTGROUP", "FIELDSET"]);
  // 语境标签：单独成根会丢布局（td 离开 table 就没有表格布局、li 离开列表就丢标记）→ 补上祖先链。
  const CONTEXT_CHAIN = {
    TD: ["TABLE", "TBODY", "THEAD", "TFOOT", "TR"],
    TH: ["TABLE", "TBODY", "THEAD", "TFOOT", "TR"],
    TR: ["TABLE", "TBODY", "THEAD", "TFOOT"],
    THEAD: ["TABLE"], TBODY: ["TABLE"], TFOOT: ["TABLE"], CAPTION: ["TABLE"], COLGROUP: ["TABLE"], COL: ["TABLE", "COLGROUP"],
    LI: ["UL", "OL", "MENU"], DT: ["DL"], DD: ["DL"],
    OPTION: ["SELECT", "OPTGROUP"], OPTGROUP: ["SELECT"],
  };
  const only_map = new Map();
  const chain = [];
  if (CONTEXT_CHAIN[target.tagName]) {
    const family = CONTEXT_CHAIN[target.tagName];
    let node = target.parentElement;
    while (node && chain.length < 4 && family.indexOf(node.tagName) !== -1) {
      chain.unshift(node);
      node = node.parentElement;
    }
    for (let index = 0; index < chain.length; index += 1) {
      only_map.set(chain[index], index + 1 < chain.length ? chain[index + 1] : target);
    }
  }

  // 包裹层的样式最后统一写（见 harden）：这里先不碰，免得 CSSOM 把 all 展开。
  const wrapper = doc.createElement("div");

  function copy_attributes(node, live) {
    const is_svg = live.namespaceURI === SVG_NS;
    const attrs = live.attributes;
    for (let index = 0; index < attrs.length; index += 1) {
      const name = attrs[index].name;
      const value = attrs[index].value;
      // SVG 的 href/xlink:href 是 url(#id) 引用（use / textPath），留下并重写；HTML 的 href 是交互入口，丢掉。
      if (name === "href" || name === "xlink:href") {
        if (is_svg) { try { node.setAttribute(name, value); } catch (error) { /* 忽略 */ } }
        continue;
      }
      if (DROP_ATTRS.has(name.toLowerCase()) || name.lastIndexOf("on", 0) === 0) continue;
      if (name === "id") continue;   // id 单独前缀化，避免与宿主撞名
      try { node.setAttribute(name, value); } catch (error) { /* 非法属性名忽略 */ }
    }
    if (live.id) node.setAttribute("id", live.id);
  }

  // 表单控件不像脚本那样能带内容，冻结成「禁用 + 当前值」的静态控件；文件/密码框不落值。
  function extra_attributes(node, live) {
    const tag = live.tagName.toUpperCase();
    if (tag === "IMG") {
      const source = live.currentSrc || live.src || "";
      if (source && INLINE_IMAGES && is_fetchable(source) && images.length < MAX_IMAGES) {
        images.push({ node, url: source });
      } else if (source && /^data:/i.test(source)) {
        node.setAttribute("src", source);
      } else {
        image_missing += 1;
        placeholder_style(node, live.getAttribute("alt") || "");
      }
      return;
    }
    if (tag === "INPUT") {
      const type = String(live.type || "text").toLowerCase();
      if (type !== "file" && type !== "password") node.setAttribute("value", String(live.value ?? ""));
      if (live.checked) node.setAttribute("checked", "");
      node.setAttribute("disabled", "");
      return;
    }
    if (tag === "TEXTAREA") {
      node.textContent = String(live.value ?? "");
      node.setAttribute("disabled", "");
      return;
    }
    if (tag === "SELECT") {
      const options = node.querySelectorAll("option");
      const live_options = live.options || [];
      for (let index = 0; index < options.length && index < live_options.length; index += 1) {
        if (live_options[index].selected) options[index].setAttribute("selected", "");
      }
      node.setAttribute("disabled", "");
      return;
    }
    if (FORM_TAGS.has(tag)) node.setAttribute("disabled", "");
  }

  function placeholder_style(node, alt) {
    force_declaration(node, "background-image", PLACEHOLDER_IMAGE);
    force_declaration(node, "background-color", "#f1f3f5");
    if (alt) node.setAttribute("title", alt);
  }

  // canvas 的画布内容不是 DOM，只能转 data URL；被污染（跨域）时退化为占位块。
  function build_canvas(live, parent_values) {
    element_count += 1;
    let data = "";
    try { data = live.toDataURL(); } catch (error) { data = ""; }
    const node = doc.createElement("img");
    const values = read_all(view.getComputedStyle(live));
    apply_diff(node, values, parent_values, false);
    copy_attributes(node, live);
    if (data && data !== "data:,") node.setAttribute("src", data);
    else { image_missing += 1; placeholder_style(node, live.getAttribute("aria-label") || "canvas"); }
    return node;
  }

  // 伪元素实体化成真实子元素，带自己的差分样式（基线 = 起源元素的计算值）。
  function build_pseudo(live, pseudo, parent_values) {
    let style = null;
    try { style = view.getComputedStyle(live, pseudo); } catch (error) { return null; }
    if (!style) return null;
    const content = String(style.getPropertyValue("content") || "").trim();
    if (!content || content === "none" || content === "normal") return null;
    // 只接受「纯字符串」的 content：counter()/attr()/url() 都还原不了。
    const strings = content.match(/"[^"]*"/g);
    if (!strings || content.replace(/"[^"]*"/g, "").trim() !== "") return null;
    const text = strings.map((part) => part.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\")).join("");
    const node = doc.createElement("span");
    apply_diff(node, read_all(style), parent_values, false);
    node.textContent = text;
    return node;
  }

  function append_children(node, live, values, depth, only) {
    if (depth > MAX_DEPTH) return;
    if (MATERIALIZE_PSEUDO) {
      const before = build_pseudo(live, "::before", values);
      if (before) node.appendChild(before);
    }
    const kids = only ? [only] : Array.prototype.slice.call(live.childNodes);
    for (const kid of kids) {
      if (kid.nodeType === 3) { node.appendChild(doc.createTextNode(kid.nodeValue)); continue; }
      if (kid.nodeType !== 1) continue;
      const chained = only_map.get(kid);
      if (!chained && (IGNORE_TAGS.has(kid.tagName) || kid.tagName === "HEAD")) continue;
      if (kid.tagName === "CANVAS") { node.appendChild(build_canvas(kid, values)); continue; }
      node.appendChild(build_node(kid, values, depth + 1, chained || null, false));
    }
    if (MATERIALIZE_PSEUDO) {
      const after = build_pseudo(live, "::after", values);
      if (after) node.appendChild(after);
    }
  }

  function build_node(live, parent_values, depth, only, is_root) {
    element_count += 1;
    if (element_count > MAX_ELEMENTS) throw new Error(`选区元素过多（超过 ${MAX_ELEMENTS} 个），请缩小范围`);
    const node = live.namespaceURI && live.namespaceURI !== XHTML_NS
      ? doc.createElementNS(live.namespaceURI, live.tagName)
      : doc.createElement(live.tagName.toLowerCase());
    const values = read_all(view.getComputedStyle(live));
    apply_diff(node, values, parent_values, is_root);
    copy_attributes(node, live);
    append_children(node, live, values, depth + 1, only);
    extra_attributes(node, live);   // 必须在子节点之后：select 的 selected / textarea 的当前值要按已建好的子树对齐
    return node;
  }

  let frozen = null;
  // html / body 单独成根会被宿主文档解析器拆掉（<html> 不能出现在 div 里），
  // 而且整页背景会被提升到 canvas 上：把它们的样式与子节点折叠进包裹层。
  const collapse = target.tagName === "HTML" || target.tagName === "BODY";
  try {
    if (collapse) {
      const scope = target.tagName === "HTML" ? (doc.body || target) : target;
      // 整页背景常挂在 html 上（浏览器会把它提升到 canvas，body 自己是透明的）→ 先借过来，
      // 再叠 body 自己的差分：同一属性后写者胜，所以 body 的背景不会被抢走。
      const root_style = view.getComputedStyle(doc.documentElement);
      if (root_style.backgroundColor !== "rgba(0, 0, 0, 0)") set_declaration(wrapper, "background-color", root_style.backgroundColor);
      if (root_style.backgroundImage !== "none") set_declaration(wrapper, "background-image", root_style.backgroundImage);
      const values = read_all(view.getComputedStyle(scope));
      for (let index = 0; index < NAMES.length; index += 1) {
        const name = NAMES[index];
        // 页面级边距不属于片段；包裹层本身就是 all:initial + block。
        // 宽高同理不冻结：折叠后包裹层就是片段的最外层，它得能跟着结果页的尺寸走。
        if (skip_property(name) || name.lastIndexOf("margin", 0) === 0 || name === "width" || name === "height") continue;
        const value = values[index];
        if (!value || value === INITIAL[index]) continue;
        set_declaration(wrapper, name, name === "font-family" ? with_fallback(value) : value);
      }
      const position = at(values, "position");
      if (position === "fixed" || position === "sticky") force_declaration(wrapper, "position", "relative");
      append_children(wrapper, scope, values, 1, null);
      frozen = wrapper;
    } else {
      const root_live = chain.length ? chain[0] : target;
      frozen = build_node(root_live, INITIAL, 0, only_map.get(root_live) || null, true);
      wrapper.appendChild(frozen);
    }
  } catch (error) {
    return fail(error && error.message ? error.message : String(error));
  }

  // —— 3) id 前缀化：同一份片段可能被放进已有同名 id 的宿主里 ——
  const ID_URL_ATTRS = new Set(["href", "xlink:href", "clip-path", "mask", "filter", "fill", "stroke", "marker-start", "marker-mid", "marker-end"]);
  const ID_REF_ATTRS = new Set(["for", "headers", "list", "form", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-flowto", "aria-details", "aria-errormessage"]);
  const short_id = String(uuid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || String(Date.now());
  const PREFIX = `dmc-${short_id}-`;
  const id_map = new Map();
  const id_nodes = [];
  (function collect_ids(node) {
    if (node.getAttribute && node.getAttribute("id")) {
      id_map.set(node.getAttribute("id"), PREFIX + node.getAttribute("id"));
      id_nodes.push(node);
    }
    const children = node.children || [];
    for (let index = 0; index < children.length; index += 1) collect_ids(children[index]);
  })(frozen);
  if (id_map.size) {
    const rewrite_url_value = (value) => value.replace(/#([^\s)'"]+)/g, (whole, name) => (id_map.has(name) ? `#${id_map.get(name)}` : whole));
    const rewrite_style_value = (value) => value.replace(/url\(\s*(['"]?)#([^'")]+)\1\s*\)/gi, (whole, quote, name) => (id_map.has(name) ? `url(${quote}#${id_map.get(name)}${quote})` : whole));
    const rewrite_ref_value = (value) => value.split(/\s+/).map((token) => (id_map.has(token) ? id_map.get(token) : token)).join(" ");
    for (const node of id_nodes) node.setAttribute("id", id_map.get(node.getAttribute("id")));
    (function rewrite(node) {
      const attrs = node.attributes || [];
      for (let index = 0; index < attrs.length; index += 1) {
        const name = attrs[index].name.toLowerCase();
        if (name === "id") continue;
        if (name === "style") node.setAttribute("style", rewrite_style_value(attrs[index].value));
        else if (ID_URL_ATTRS.has(name)) node.setAttribute(attrs[index].name, rewrite_url_value(attrs[index].value));
        else if (ID_REF_ATTRS.has(name)) node.setAttribute(attrs[index].name, rewrite_ref_value(attrs[index].value));
      }
      const children = node.children || [];
      for (let index = 0; index < children.length; index += 1) rewrite(children[index]);
    })(frozen);
  }

  // —— 4) 资源内联：fetch → blob → FileReader 的 data URL；取不到就退占位 / 丢声明 ——
  function to_data_url(url) {
    return fetch(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    }).then((blob) => {
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("资源过大");
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取资源失败"));
        reader.readAsDataURL(blob);
      });
    });
  }

  const resolved = new Map();
  if (urls.size) {
    const list = Array.from(urls);
    let total = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const url = list[cursor];
        cursor += 1;
        try {
          const data = await to_data_url(url);
          if (total + data.length > MAX_TOTAL_BYTES) throw new Error("内联总体积超限");
          total += data.length;
          resolved.set(url, data);
        } catch (error) {
          resolved.set(url, null);
        }
      }
    };
    const runners = [];
    for (let index = 0; index < Math.min(6, list.length); index += 1) runners.push(worker());
    await Promise.all(runners);
  }

  for (const item of declarations) {
    let ok = true;
    const value = item.value.replace(url_re(), (whole, quote, url) => {
      if (!is_fetchable(url)) return whole;
      const data = resolved.get(url);
      if (!data) { ok = false; return whole; }
      return `url("${data}")`;
    });
    if (!ok) continue;   // 有取不到的 url → 整条声明丢弃（宁可少一条样式，也不留外链）
    try { item.node.style.setProperty(item.name, value, PRIORITY); } catch (error) { /* 忽略 */ }
  }
  for (const item of images) {
    const data = resolved.get(item.url);
    if (data) item.node.setAttribute("src", data);
    else { image_missing += 1; placeholder_style(item.node, item.node.getAttribute("alt") || ""); }
  }

  // —— 5) 逐元素在最前面塞 `all:unset`（根是 all:initial）——
  // 宿主 `*{box-sizing:border-box}`、`img{max-width:100%}`、`*{...!important}` 这类规则
  //（Tailwind preflight 就是）否则会命中我们「没写」的属性：差分的省写前提正是「没写 = 初始值」。
  // 与差分基线同源：非继承属性回落到初始值，继承属性照常从冻结后的父节点继承
  //（根节点上面是 all:initial 的包裹层，等于初始值）。
  // 必须走「字符串写 style 属性」：用 CSSOM 的 setProperty 写 all、再写第二条声明时，
  // Chrome 会把 all 展开成几百条 longhand 序列化回来（每个元素凭空多出 6KB）。
  const RESET = IMPORTANT ? "all:unset!important;" : "all:unset;";
  (function harden(node, is_root) {
    const declarations = node.style.cssText;
    node.setAttribute("style", is_root ? `all:initial!important;display:block!important;${declarations}` : `${RESET}${declarations}`);
    const children = node.children || [];
    for (let index = 0; index < children.length; index += 1) harden(children[index], false);
  })(wrapper, true);

  const html = wrapper.outerHTML;
  const rect = target.getBoundingClientRect();
  return {
    ok: true,
    html,
    stats: {
      node: label_of(target),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      elements: element_count,
      images: images.length,
      image_missing,
      bytes: new TextEncoder().encode(html).length,
    },
  };
}

// 在页面上下文中执行：框选/悬停选节点 → 打标记 → 交给 SW 提取。
// 必须自包含（不引用模块作用域）。同步返回，注入调用不会等用户操作。
export function clip_region(options) {
  const MARKER = "data-dm-clip-target";
  const HOST_ID = "dm-clip-picker";
  const opts = options && typeof options === "object" ? options : {};

  const previous = document.getElementById(HOST_ID);
  if (previous) previous.remove();

  const doc = document;
  const view = window;

  function label_of(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) return `${tag}#${element.id}`;
    const name = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean)[0] : "";
    return name ? `${tag}.${name}` : tag;
  }

  // 与 detection.model.js 的 identify_container 同源（注入函数不能 import，所以内联一份）：
  // 框选目标 = 完全包含选区的最深节点；小于 4px（点了没拖）取该点最深元素。
  function contains(outer, rect, tolerance) {
    return outer.left <= rect.left + tolerance && outer.top <= rect.top + tolerance
      && outer.right >= rect.right - tolerance && outer.bottom >= rect.bottom - tolerance;
  }

  function identify_container(rect) {
    const fallback = doc.body || doc.documentElement;
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    let hit = null;
    try { hit = doc.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2); } catch (error) { hit = null; }
    if (!hit || hit.nodeType !== 1) return fallback;
    if (width < 4 || height < 4) return hit;
    for (let node = hit; node && node.nodeType === 1; node = node.parentElement) {
      if (contains(node.getBoundingClientRect(), rect, 0.5)) return node;
    }
    return fallback;
  }

  const host = doc.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("style", "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;contain:strict!important");
  const root = host.attachShadow({ mode: "open" });
  // 选择器 UI 全部收在 Shadow DOM 里：页面样式影响不到它，它也漏不到页面。
  root.innerHTML = [
    "<style>",
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".marquee,.container,.bar,.status{display:none}",
    ".marquee,.container{position:absolute;pointer-events:none}",
    ".marquee{border:1px dashed Highlight;background:color-mix(in srgb,Highlight 12%,transparent)}",
    ".container{border:2px solid Highlight}",
    ".marquee.is-on{display:block}",
    ".container.is-on{display:block}",
    ".bar.is-on{display:flex}",
    ".status.is-on{display:block}",
    ".bar{position:absolute;align-items:center;gap:6px;padding:4px 6px;border:1px solid GrayText;border-radius:6px;background:Canvas;color:CanvasText;box-shadow:0 4px 16px rgba(0,0,0,.25);font:12px/1.4 system-ui,sans-serif;pointer-events:auto}",
    ".label{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:GrayText;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}",
    "button{padding:2px 8px;border:1px solid GrayText;border-radius:4px;background:Canvas;color:CanvasText;font:inherit;cursor:pointer}",
    "button:hover:not(:disabled){background:color-mix(in srgb,CanvasText 8%,Canvas)}",
    "button:disabled{color:GrayText;cursor:not-allowed}",
    ".hint{position:absolute;left:8px;top:8px;max-width:calc(100% - 16px);padding:4px 8px;border:1px solid GrayText;border-radius:6px;background:Canvas;color:CanvasText;font:12px/1.5 system-ui,sans-serif;pointer-events:none}",
    ".status{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);padding:6px 12px;border:1px solid GrayText;border-radius:6px;background:Canvas;color:CanvasText;box-shadow:0 4px 16px rgba(0,0,0,.25);font:12px/1.5 system-ui,sans-serif}",
    "</style>",
    '<div class="marquee"></div>',
    '<div class="container"></div>',
    '<div class="bar"><span class="label"></span>',
    '<button type="button" data-act="up" title="选择父级容器（↑）">↑ 父级</button>',
    '<button type="button" data-act="down" title="选择子级容器（↓）">↓ 子级</button>',
    '<button type="button" data-act="save" title="剪藏（回车）">剪藏</button>',
    '<button type="button" data-act="cancel" title="取消（Esc）">取消</button></div>',
    '<div class="hint">拖动框选区域（单击选节点）· ↑/↓ 切换父/子容器 · 回车剪藏 · Esc 取消</div>',
    '<div class="status"></div>',
  ].join("");
  const marquee = root.querySelector(".marquee");
  const container = root.querySelector(".container");
  const bar = root.querySelector(".bar");
  const label = root.querySelector(".label");
  const status = root.querySelector(".status");
  const up_button = root.querySelector('[data-act="up"]');
  const down_button = root.querySelector('[data-act="down"]');
  const save_button = root.querySelector('[data-act="save"]');

  doc.documentElement.appendChild(host);
  // 页面上给个十字光标（还原时要放回原值）。
  const html_element = doc.documentElement;
  const previous_cursor = html_element.style.getPropertyValue("cursor");
  const previous_priority = html_element.style.getPropertyPriority("cursor");
  html_element.style.setProperty("cursor", "crosshair", "important");

  let chain = [];
  let index = 0;
  let dragging = false;
  let start_point = null;
  let drag_rect = null;
  let busy = false;

  function current() { return chain[index] || null; }

  function build_chain(element) {
    const list = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== doc.documentElement && list.length < 200) {
      list.push(node);
      if (node === doc.body) break;
      node = node.parentElement;
    }
    return list;
  }

  function place(node, rect) {
    node.style.left = `${Math.round(rect.left)}px`;
    node.style.top = `${Math.round(rect.top)}px`;
    node.style.width = `${Math.round(rect.width)}px`;
    node.style.height = `${Math.round(rect.height)}px`;
  }

  function place_bar(rect) {
    bar.classList.add("is-on");
    const width = bar.offsetWidth;
    const height = bar.offsetHeight;
    let left = rect.right - width;
    let top = rect.bottom + 6;
    if (top + height > view.innerHeight - 4) top = rect.top - height - 6;
    if (top < 4) top = 4;
    left = Math.max(4, Math.min(left, view.innerWidth - width - 4));
    bar.style.left = `${Math.round(left)}px`;
    bar.style.top = `${Math.round(top)}px`;
  }

  function render() {
    const element = current();
    if (!element) {
      container.classList.remove("is-on");
      bar.classList.remove("is-on");
      return;
    }
    const rect = element.getBoundingClientRect();
    container.classList.add("is-on");
    place(container, rect);
    label.textContent = label_of(element) + (chain.length > 1 ? ` · ${index + 1}/${chain.length}` : "");
    up_button.disabled = index >= chain.length - 1;
    down_button.disabled = index <= 0;
    place_bar(rect);
  }

  // 滚动/缩放后所有位置一律由元素当下的 rect 现算（遮罩是视口固定层，页面滚动后它会「粘」在原地）。
  function reposition() {
    render();
  }

  function show_status(text) {
    status.textContent = text;
    status.classList.add("is-on");
  }

  function destroy() {
    doc.removeEventListener("pointerdown", on_down, true);
    doc.removeEventListener("pointermove", on_move, true);
    doc.removeEventListener("pointerup", on_up, true);
    doc.removeEventListener("keydown", on_key, true);
    doc.removeEventListener("scroll", reposition, true);
    view.removeEventListener("resize", reposition);
    if (previous_cursor) html_element.style.setProperty("cursor", previous_cursor, previous_priority);
    else html_element.style.removeProperty("cursor");
    host.remove();
  }

  function cancel() {
    destroy();
  }

  function confirm() {
    const element = current();
    if (!element || busy) return;
    busy = true;
    const uuid = view.crypto && view.crypto.randomUUID
      ? view.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    element.setAttribute(MARKER, uuid);
    marquee.classList.remove("is-on");
    container.classList.remove("is-on");
    bar.classList.remove("is-on");
    show_status(`正在提取 ${label_of(element)} …`);
    const message = {
      action: "clip-region",
      target: uuid,
      node: label_of(element),
      url: location.href,
      title: document.title,
      options: opts,
    };
    Promise.resolve(chrome.runtime.sendMessage(message)).then((response) => {
      if (response && response.success) {
        show_status(`已剪藏 ${response.elements ?? 0} 个元素${response.image_missing ? `（${response.image_missing} 张图取不到，已占位）` : ""}，结果页已打开`);
        view.setTimeout(destroy, 1500);
        return;
      }
      element.removeAttribute(MARKER);
      busy = false;
      show_status(`剪藏失败：${(response && response.error) || "未知错误"}`);
      render();
    }, (error) => {
      element.removeAttribute(MARKER);
      busy = false;
      show_status(`剪藏失败：${error && error.message ? error.message : String(error)}`);
      render();
    });
  }

  function in_host(event) {
    return event.target === host || (event.composedPath && event.composedPath().indexOf(host) !== -1);
  }

  function on_down(event) {
    if (in_host(event) || busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    start_point = { x: event.clientX, y: event.clientY };
    drag_rect = { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY };
    place(marquee, { left: drag_rect.left, top: drag_rect.top, width: 0, height: 0 });
    marquee.classList.add("is-on");
  }

  function on_move(event) {
    if (in_host(event) || busy) return;
    if (dragging) {
      event.preventDefault();
      drag_rect = {
        left: Math.min(start_point.x, event.clientX),
        top: Math.min(start_point.y, event.clientY),
        right: Math.max(start_point.x, event.clientX),
        bottom: Math.max(start_point.y, event.clientY),
      };
      place(marquee, { left: drag_rect.left, top: drag_rect.top, width: drag_rect.right - drag_rect.left, height: drag_rect.bottom - drag_rect.top });
      return;
    }
    // 悬停高亮：直接就是候选链的起点，所见即所得。
    let hit = null;
    try { hit = doc.elementFromPoint(event.clientX, event.clientY); } catch (error) { hit = null; }
    if (!hit || hit.nodeType !== 1 || hit === doc.documentElement) return;
    chain = build_chain(hit);
    index = 0;
    render();
  }

  function on_up(event) {
    if (in_host(event) || busy || !dragging) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = false;
    marquee.classList.remove("is-on");
    if (!drag_rect) return;
    const box = { left: drag_rect.left, top: drag_rect.top, right: drag_rect.right, bottom: drag_rect.bottom };
    drag_rect = null;
    const element = identify_container(box);
    if (element && element.nodeType === 1 && element !== doc.documentElement) {
      chain = build_chain(element);
      index = 0;
    }
    render();
  }

  function on_key(event) {
    if (busy) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); confirm(); return; }
    if (event.key === "ArrowUp" && index < chain.length - 1) { event.preventDefault(); index += 1; render(); return; }
    if (event.key === "ArrowDown" && index > 0) { event.preventDefault(); index -= 1; render(); }
  }

  bar.addEventListener("click", (event) => {
    const button = event.target.closest ? event.target.closest("button") : null;
    if (!button) return;
    const act = button.getAttribute("data-act");
    if (act === "save") confirm();
    else if (act === "cancel") cancel();
    else if (act === "up" && index < chain.length - 1) { index += 1; render(); }
    else if (act === "down" && index > 0) { index -= 1; render(); }
  });

  doc.addEventListener("pointerdown", on_down, true);
  doc.addEventListener("pointermove", on_move, true);
  doc.addEventListener("pointerup", on_up, true);
  doc.addEventListener("keydown", on_key, true);
  doc.addEventListener("scroll", reposition, true);
  view.addEventListener("resize", reposition);

  return { ok: true };
}

// 由 SW 调用：把 extract_clip 注入目标标签页并取回片段。
export async function extract_region(tab_id, uuid, options) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab_id },
    func: extract_clip,
    args: [uuid, normalize_clip_options(options)],
  });
  const result = injected && injected[0] ? injected[0].result : null;
  return result || { ok: false, error: "注入未返回结果" };
}

// SW 侧：把页面上报的信息与提取结果拼成一条剪藏记录。
export function build_clip_record(message, result) {
  const url = String(message?.url || "");
  const html = String(result?.html || "");
  const stats = result?.stats || {};
  return {
    id: String(message?.target || ""),
    url,
    title: String(message?.title || "").trim() || url || "未命名剪藏",
    node: String(message?.node || stats.node || ""),
    hostname: hostname_of(url),
    html,
    width: Number(stats.width) || 0,
    height: Number(stats.height) || 0,
    element_count: Number(stats.elements) || 0,
    image_count: Number(stats.images) || 0,
    image_missing: Number(stats.image_missing) || 0,
    byte_size: Number(stats.bytes) || 0,
    options: normalize_clip_options(message?.options),
    created_at: Date.now(),
  };
}

// SW 侧：落库（新的在前，超出上限丢最旧的）。
export async function save_clips(client, record) {
  const saved = await client.storage.local.get(clips_key);
  const list = normalize_clip_records(saved?.[clips_key]).filter((item) => item.id !== record.id);
  list.unshift(record);
  const limited = list.slice(0, MAX_CLIP_RECORDS);
  await client.storage.local.set({ [clips_key]: limited });
  return limited.length;
}
