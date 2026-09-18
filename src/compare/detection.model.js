export const detection_rules_key = "detection-rules";

export const DETECTION_TYPE_LABELS = { color: "颜色为", content: "内容匹配", script: "JS 函数", list: "列表对比" };

// 需要 chrome.userScripts（「允许用户脚本」）才能在页面里执行用户代码的类型。
export const USER_SCRIPT_TYPES = new Set(["script", "list"]);

// 检测规则按其来源地址限定作用范围：从暂存记录的 url 得到 hostname，只有同一 hostname 的页面才允许检测。
export function hostname_of(url) {
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.hostname : "";
  } catch { return ""; }
}

// 节点展示名（仅用于界面）：优先 id，其次首个类名，否则标签名。
export function node_label(element) {
  if (!element || element.nodeType !== 1) return "";
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${element.id}`;
  const class_name = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean)[0] : "";
  return class_name ? `${tag}.${class_name}` : tag;
}

function css_escape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

// 元素在同类兄弟中的序号（nth-of-type 的 k）。
function nth_of_type(element) {
  let index = 1;
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    if (sibling.tagName === element.tagName) index += 1;
  }
  return index;
}

// 构建可在 live 页面 querySelector 命中的选择器：以唯一的 #id 为锚点，否则逐层 tag:nth-of-type(k)，
// 一直到 body 收尾，用 " > " 连接。不使用 class（暂存页面里的 class 常是 hash/自动生成，跨快照不稳定）。
export function build_selector(element) {
  if (!element || element.nodeType !== 1) return "";
  const doc = element.ownerDocument;
  const segments = [];
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const tag = node.tagName.toLowerCase();
    if (node.id) {
      const escaped = css_escape(node.id);
      let unique = false;
      try { unique = doc.querySelectorAll(`#${escaped}`).length === 1; } catch { unique = false; }
      if (unique) {
        segments.unshift(`#${escaped}`);
        break;
      }
    }
    if (tag === "body" || tag === "html") {
      segments.unshift(tag);
      break;
    }
    segments.unshift(`${tag}:nth-of-type(${nth_of_type(node)})`);
  }
  return segments.join(" > ");
}

function contains(outer, rect, tolerance) {
  return outer.left <= rect.left + tolerance && outer.top <= rect.top + tolerance
    && outer.right >= rect.right - tolerance && outer.bottom >= rect.bottom - tolerance;
}

// 框选目标 = 完全包含选区的最深（面积最小）节点。
// 用「中心点向上回溯」而不是全量扫描：从中心点最深元素沿 parentElement 上溯，
// 取第一个 bbox 完全包含选区的元素（devtools marquee 的模型），避免误选绝对定位浮层。
// 选区小于 4px（点了没拖）时退化为「取该点最深元素」，避免产生退化规则。
export function identify_container(doc, rect) {
  if (!doc || !rect) return (doc && (doc.body || doc.documentElement)) || null;
  const fallback = doc.body || doc.documentElement;
  const width = typeof rect.width === "number" ? rect.width : rect.right - rect.left;
  const height = typeof rect.height === "number" ? rect.height : rect.bottom - rect.top;
  const center_x = (rect.left + rect.right) / 2;
  const center_y = (rect.top + rect.bottom) / 2;
  let hit = null;
  try { hit = doc.elementFromPoint(center_x, center_y); } catch { hit = null; }
  if (!hit || hit.nodeType !== 1) return fallback;
  if (width < 4 || height < 4) return hit;
  const tolerance = 0.5;
  for (let node = hit; node && node.nodeType === 1; node = node.parentElement) {
    if (contains(node.getBoundingClientRect(), rect, tolerance)) return node;
  }
  return fallback;
}

// 框选内容的结构判定：详情（单一内容）还是列表（多个结构相同的子节点）。
// 只用标签树 + textContent + outerHTML —— 不碰 class（暂存页里常是哈希/自动生成的）、
// 不碰计算样式、不碰布局，因此在实时 DOM 与将来的服务端解析器上都可用同一份逻辑。
// 结构指纹 = 子树的标签名形状，例如 UL(LI(A,SPAN),LI(A,SPAN))。
// 自包含（不引用模块作用域）：会被 toString() 内联进 userScripts 注入代码。
export function inspect_content(element) {
  function fingerprint(node) {
    const tag = node.tagName ? node.tagName.toUpperCase() : "";
    const children = node.children || [];
    const parts = [];
    for (let index = 0; index < children.length; index += 1) parts.push(fingerprint(children[index]));
    return `${tag}(${parts.join(",")})`;
  }

  function read(node) {
    const children = node.children || [];
    const groups = {};
    const order = [];
    for (let index = 0; index < children.length; index += 1) {
      const key = fingerprint(children[index]);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(children[index]);
    }
    // 最大的同指纹分组：>= 2 个、且占比 >= 一半 → 列表；否则当详情。
    let best = [];
    for (const key of order) if (groups[key].length > best.length) best = groups[key];
    const is_list = best.length >= 2 && best.length * 2 >= children.length;
    const items = is_list ? best.map((child) => read(child)) : [];
    return {
      shape: is_list ? "list" : "detail",
      item_count: items.length,
      html: node.outerHTML || "",
      text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
      items,
    };
  }

  return read(element);
}

// 形态展示名（仅用于界面）：列表 · N 项 / 详情；老规则没有该字段时返回空串（不渲染徽标）。
export function describe_shape(rule) {
  const shape = rule && rule.shape;
  if (shape === "list") return `列表 · ${Number(rule.item_count) || 0} 项`;
  return shape === "detail" ? "详情" : "";
}

// 同一次预览（同一 group_id）的规则按 created_at 编号，编号即用户函数里 others 的键。
// 没有 group_id 的老规则只有自己：others 为空对象。列表顺序稳定 → 预览页与弹窗编号一致。
export function number_rules(rules, rule) {
  const group_id = rule && typeof rule.group_id === "string" ? rule.group_id.trim() : "";
  const list = (Array.isArray(rules) ? rules : []).filter((item) => item && typeof item === "object")
    .filter((item) => group_id ? item.group_id === group_id : item.id === (rule && rule.id));
  return list.slice()
    .sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0))
    .map((item, index) => ({ ...item, number: index + 1 }));
}

// 基线项数上限：基线会被内联进注入代码并写进 storage，别让它无限膨胀。
const BASELINE_KEY_LIMIT = 500;

// 校验并归一「列表对比」的基线（取键函数的输出）。只接受非 null 的普通对象，
// 每项是对象、字段值全是字符串 / 数字 / 布尔 / null（diff 用 === 浅比较）。
// 经 JSON round-trip 落成纯 JSON，将来可直接 POST 给后端。
// 返回 { baseline, error }：合法时 baseline 为纯 JSON 对象，非法时为 null 并给出 error 文案。
// 同时用于「首次检测写回基线」的入口校验与 normalize_detection_rules 的加载归一。
export function read_baseline(value) {
  if (value === null || value === undefined) return { baseline: null, error: "" };
  if (typeof value !== "object" || Array.isArray(value)) return { baseline: null, error: "基线应为「键 → 字段」的对象" };
  const keys = Object.keys(value);
  if (keys.length > BASELINE_KEY_LIMIT) return { baseline: null, error: `基线项数超过上限（${BASELINE_KEY_LIMIT}）` };
  for (const key of keys) {
    const item = value[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { baseline: null, error: `基线「${key}」的值应为对象` };
    for (const name of Object.keys(item)) {
      const field = item[name];
      if (field !== null && !["string", "number", "boolean"].includes(typeof field)) {
        return { baseline: null, error: `基线「${key}.${name}」的值只能是字符串 / 数字 / 布尔 / null` };
      }
    }
  }
  return { baseline: JSON.parse(JSON.stringify(value)), error: "" };
}

// 生成 JS 函数规则的注入代码（字符串），由 chrome.userScripts.execute({ js: [{ code }] }) 执行。
// 宿主侧只允许 3 个处处都有的原语：按选择器取节点、取 outerHTML、取文本（见 inspect_content），
// 与将来的服务端解析器（如 Cheerio 的 $(sel).first() / $.html(el) / el.text()）一一对应 —— 换掉这层壳，函数体原样搬。
// 内容一律运行时现取：只嵌选择器（self 与 others）与用户代码，不嵌 HTML。
// group 必须是已按 created_at 编号的数组（见 number_rules），编号即 others 的键。
export function build_script_code(rule, group) {
  const selector = JSON.stringify(String((rule && rule.selector) || ""));
  const others = {};
  for (const item of Array.isArray(group) ? group : []) {
    if (!item || typeof item.selector !== "string" || !item.selector) continue;
    if (item.id === (rule && rule.id)) continue;
    others[String(item.number)] = item.selector;
  }
  const code = String((rule && rule.code) || "");
  return `(function () {
  ${inspect_content.toString()}
  function read_content(selector) {
    var element = null;
    try { element = selector ? document.querySelector(selector) : null; } catch (error) { element = null; }
    return element ? inspect_content(element) : null;
  }
  function describe(value) {
    if (value.shape === "list") {
      var each = value.items.length ? String(value.items[0].text.length) : "0";
      return "列表 · " + value.item_count + " 项 · 各 " + each + " 字";
    }
    return "详情 · " + value.text.length + " 字";
  }
  var self = read_content(${selector});
  if (!self) return { found: false, passed: false, kind: "script", actual: "", message: "未找到目标节点（页面结构可能已变化）" };
  var selectors = ${JSON.stringify(others)};
  var others = {};
  var missing = 0;
  var total = 0;
  for (var key in selectors) {
    total += 1;
    var value = read_content(selectors[key]);
    others[key] = value;
    if (!value) missing += 1;
  }
  var actual = describe(self) + (missing ? " · 其他框选 " + missing + "/" + total + " 未找到" : "");
  var passed;
  try {
    passed = (function (self, others) {
${code}
    })(self, others);
  } catch (error) {
    return { found: true, passed: false, kind: "script", actual: actual, message: "函数执行出错：" + (error && error.message ? error.message : String(error)), error: true };
  }
  if (passed === undefined) return { found: true, passed: false, kind: "script", actual: actual, message: "函数没有返回值（是否忘了 return？）", error: true };
  passed = Boolean(passed);
  return { found: true, passed: passed, kind: "script", actual: actual, message: passed ? "满足条件" : "不满足条件" };
})()`;
}

// 生成「列表对比」规则的注入代码（字符串）：内联自包含的取内容函数与 read_content。
// 基线为 null 时回传本次取键结果（snapshot，由宿主写进规则后丢弃），否则按键做 diff。
// 只嵌选择器、基线与用户函数体，不嵌页面 HTML —— 内容一律运行时现取。
// 用户函数体形如 `function (self) { … }` 的花括号内部，返回 { 键: { 字段: 值 } }。
export function build_list_code(rule) {
  const selector = JSON.stringify(String((rule && rule.selector) || ""));
  const baseline = (rule && rule.baseline) || null;
  const code = String((rule && rule.code) || "");
  return `(function () {
  ${inspect_content.toString()}
  function read_content(selector) {
    var element = null;
    try { element = selector ? document.querySelector(selector) : null; } catch (error) { element = null; }
    return element ? inspect_content(element) : null;
  }
  var self = read_content(${selector});
  if (!self) return { found: false, passed: false, kind: "list", actual: "", message: "未找到目标节点（页面结构可能已变化）" };
  var current;
  try {
    current = (function (self) {
${code}
    })(self);
  } catch (error) {
    return { found: true, passed: false, kind: "list", actual: "", message: "函数执行出错：" + (error && error.message ? error.message : String(error)), error: true };
  }
  if (current === undefined) return { found: true, passed: false, kind: "list", actual: "", message: "函数没有返回值（是否忘了 return？）", error: true };
  if (!current || typeof current !== "object" || Array.isArray(current)) return { found: true, passed: false, kind: "list", actual: "", message: "函数应返回「键 → 字段」的对象", error: true };
  var keys = Object.keys(current);
  for (var index = 0; index < keys.length; index += 1) {
    var item = current[keys[index]];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { found: true, passed: false, kind: "list", actual: "", message: "「" + keys[index] + "」的值不是对象", error: true };
  }
  var baseline = ${JSON.stringify(baseline)};
  if (baseline === null) {
    return { baseline: true, kind: "list", snapshot: current, baseline_count: keys.length, current_count: keys.length, actual: "基线 " + keys.length + " 项", message: "已记录基线 " + keys.length + " 项，下次检测开始比对" };
  }
  var baseline_keys = Object.keys(baseline);
  var added = [];
  var updated = [];
  var removed = [];
  for (var next = 0; next < keys.length; next += 1) {
    var key = keys[next];
    if (!Object.prototype.hasOwnProperty.call(baseline, key)) { added.push(key); continue; }
    var before = baseline[key];
    var after = current[key];
    // 比较取两侧字段名的并集：任一侧删掉字段都要算更新。
    var names = [];
    var before_names = Object.keys(before);
    var after_names = Object.keys(after);
    for (var b = 0; b < before_names.length; b += 1) if (names.indexOf(before_names[b]) === -1) names.push(before_names[b]);
    for (var a = 0; a < after_names.length; a += 1) if (names.indexOf(after_names[a]) === -1) names.push(after_names[a]);
    var fields = [];
    for (var n = 0; n < names.length; n += 1) if (before[names[n]] !== after[names[n]]) fields.push(names[n]);
    if (fields.length) updated.push({ key: key, fields: fields });
  }
  for (var prev = 0; prev < baseline_keys.length; prev += 1) {
    if (!Object.prototype.hasOwnProperty.call(current, baseline_keys[prev])) removed.push(baseline_keys[prev]);
  }
  var counts = { added: added.length, updated: updated.length, removed: removed.length };
  var changed = counts.added + counts.updated + counts.removed > 0;
  return {
    found: true,
    passed: changed,
    kind: "list",
    actual: "新增 " + counts.added + " · 更新 " + counts.updated + " · 删除 " + counts.removed + "（基线 " + baseline_keys.length + " 项 → 当前 " + keys.length + " 项）",
    message: changed ? "有变更" : "无变更",
    diff: { added: added.slice(0, 20), updated: updated.slice(0, 20), removed: removed.slice(0, 20) },
    counts: counts,
    baseline_count: baseline_keys.length,
    current_count: keys.length,
  };
})()`;
}

// 首行代码截断后的摘要（仅用于界面）：规则行里展示「JS 函数 …」。
function first_line(code) {
  const line = String(code || "").split("\n").map((part) => part.trim()).filter(Boolean)[0] || "";
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}

export function describe_rule(rule) {
  const label = DETECTION_TYPE_LABELS[rule && rule.type] || "检测";
  if (rule && rule.type === "script") return `${label} ${first_line(rule.code)}`;
  if (rule && rule.type === "list") {
    const baseline = rule.baseline && typeof rule.baseline === "object" && !Array.isArray(rule.baseline) ? rule.baseline : null;
    return baseline ? `${label} · 基线 ${Object.keys(baseline).length} 项` : `${label} · 待记录基线`;
  }
  return `${label} ${String((rule && rule.expected) ?? "")}`;
}

// 丢弃非法项、只保留 type 合法的规则（错误 type 无法求值）、按 id 去重。
// JS 函数 / 列表对比规则还要求函数体非空（空函数体无法求值），与缺选择器同样丢弃。
// 列表对比的 baseline 经 read_baseline 归一：非法（不是对象 / 字段值嵌套 / 超上限）则置 null，下次检测重新记录。
export function normalize_detection_rules(list) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id) || !DETECTION_TYPE_LABELS[item.type]) continue;
    const selector = typeof item.selector === "string" ? item.selector.trim() : "";
    if (!selector) continue;
    const code = typeof item.code === "string" ? item.code : "";
    if (USER_SCRIPT_TYPES.has(item.type) && !code.trim()) continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "未命名规则";
    seen.add(id);
    result.push({
      id,
      name,
      type: item.type,
      expected: String(item.expected ?? ""),
      code,
      baseline: item.type === "list" ? read_baseline(item.baseline).baseline : null,
      selector,
      node: typeof item.node === "string" ? item.node : "",
      hostname: typeof item.hostname === "string" ? item.hostname : "",
      source_url: typeof item.source_url === "string" ? item.source_url : "",
      source_record_id: typeof item.source_record_id === "string" ? item.source_record_id : "",
      group_id: typeof item.group_id === "string" ? item.group_id.trim() : "",
      shape: item.shape === "list" || item.shape === "detail" ? item.shape : "",
      item_count: Number(item.item_count) || 0,
      created_at: Number(item.created_at) || 0,
    });
  }
  return result;
}

// 在页面上下文中执行：判断当前页面是否满足规则。
// 必须自包含（不引用模块作用域），因为要被 scripting.executeScript({ func }) 序列化注入页面。
export function evaluate_detection_rule(rule) {
  const kind = rule && rule.type === "content" ? "content" : "color";
  const selector = rule && typeof rule.selector === "string" ? rule.selector : "";
  const expected = String((rule && rule.expected) ?? "");

  let element = null;
  try { element = selector ? document.querySelector(selector) : null; } catch { element = null; }
  if (!element) {
    return { found: false, passed: false, kind, actual: "", message: "未找到目标节点（页面结构可能已变化）" };
  }

  // 颜色不能按字符串比较：两侧都归一化成 {r,g,b,a} 数值再比（alpha 带容差）。
  function parse_rgb_string(value) {
    const match = /^rgba?\(([^)]+)\)$/i.exec(String(value == null ? "" : value).trim());
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
    const alpha = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
  }

  // 期望值支持 #hex / 具名色 / rgb(...)：用一次性 <span> 探针让浏览器解析成 rgb(...)。
  function parse_color(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return null;
    const probe = document.createElement("span");
    probe.style.color = text;
    if (!probe.style.color) return null;
    const host = document.body || document.documentElement;
    if (host) host.appendChild(probe);
    let resolved = "";
    try { resolved = getComputedStyle(probe).color; } catch { resolved = probe.style.color; }
    if (host) host.removeChild(probe);
    return parse_rgb_string(resolved);
  }

  function same_color(a, b) {
    if (!a || !b) return false;
    return a.r === b.r && a.g === b.g && a.b === b.b && Math.abs(a.a - b.a) < 0.02;
  }

  if (kind === "content") {
    // 大小写敏感的「包含」匹配。
    const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
    const passed = text.includes(expected);
    const snippet = text.length > 80 ? `${text.slice(0, 80)}…` : text;
    return { found: true, passed, kind, actual: snippet || "（空）", message: passed ? "满足条件" : "不满足条件" };
  }

  // 颜色规则同时看 color 与 background-color，任一命中即满足。
  const view = (element.ownerDocument && element.ownerDocument.defaultView) || window;
  const styles = view.getComputedStyle(element);
  const color = styles.color || "";
  const background = styles.backgroundColor || "";
  const target = parse_color(expected);
  const passed = same_color(parse_rgb_string(color), target) || same_color(parse_rgb_string(background), target);
  return {
    found: true,
    passed,
    kind,
    actual: `文字 ${color || "（无）"} · 背景 ${background || "（无）"}`,
    message: passed ? "满足条件" : "不满足条件",
  };
}
