import { ComparisonModel, build_preview_document } from "./compare.model.js";
import { build_selector, describe_shape, detection_rules_key, hostname_of, identify_container, inspect_content, node_label, number_rules } from "./detection.model.js";

// 预览页：按 URL 中的 id 从暂存记录里取单条，完整渲染 HTML 效果（iframe 内滚动）。
// 框选：拖拽指出关心的内容块 → 登记为一条变更检测规则（写到 chrome.storage.local）。
// 可连续框选多个块，每个框画在预览页上并标号（第 1、2、3…）—— 先保存先编号；
// 编号与 JS 函数规则里 others 的键一致（见 number_rules）。
const model = ComparisonModel();
const id = new URLSearchParams(location.search).get("id");

const TYPE_OPTIONS = [["color", "颜色为"], ["content", "内容匹配"], ["script", "JS 函数"], ["list", "列表对比"]];

// 需要写函数体的类型：共用同一个 code 输入框，各自留一份草稿与模板。
const CODE_TYPES = new Set(["script", "list"]);

const SCRIPT_TEMPLATE = 'return self.text.includes("");';

// 取键模板：按站点改写即可。键由函数决定（这里用列表项文本），字段值只能是基本类型。
const LIST_TEMPLATE = [
  "var result = {};",
  "for (var i = 0; i < self.items.length; i++) {",
  "  var key = self.items[i].text;",
  "  result[key] = { text: self.items[i].text };",
  "}",
  "return result;",
].join("\n");

const SCRIPT_HINT = "函数签名 (self, others)：self 是本次框选，others[编号] 是同一次预览里的其他框（取不到为 null）；只能用 html / text / items，请勿使用 DOM API。";

const LIST_HINT = "取键函数签名 (self)：返回 { 键: { 字段: 值 } }，键与字段名都由函数决定，字段值只能是字符串 / 数字 / 布尔 / null；只能用 html / text / items，请勿使用 DOM API。保存后第一次检测记录基线，之后按键对比（顺序变化不算变更）。";

// 提取测试：拿一份 HTML 直接试「怎么取出我要的内容」。函数体在沙箱页里跑（扩展页 CSP 禁 eval），
// 拿到的 document 由 DOMParser 从 HTML 字符串解析而来 —— 有查询能力，但不加载资源、不跑页面脚本、没有布局。
const EXTRACT_TEMPLATE = [
  "// document = 这份 HTML 解析出的文档（querySelector / textContent / getAttribute 都能用）",
  "// 需要 return；返回「对象数组」时下方会额外渲染成表格",
  'return Array.from(document.querySelectorAll("a")).map((a) => ({ 文本: a.textContent.trim(), 链接: a.getAttribute("href") }));',
].join("\n");

const EXTRACT_HINT = "函数体在沙箱页执行：入参 document 由 HTML 字符串解析而来，不加载资源、不跑页面脚本、没有布局与计算样式，因此只能按标签结构取内容。需要 return，支持 await。";

const EXTRACT_SOURCES = { page: "整页 HTML", selection: "框选容器" };

// 沙箱页无响应时的等待上限：函数体死循环会把沙箱页卡住，超时后只能整个换掉重来。
const EXTRACT_TIMEOUT = 8000;

const EXTRACT_ROW_LIMIT = 200;

// 入参预览的截断上限：只截「预览」，运行照旧送完整 HTML。
const EXTRACT_HTML_LIMIT = 20000;

// 框选状态。坐标全程用 iframe 视口坐标（鼠标 clientX/Y 与元素 rect 同空间）；
// 只有画遮罩时才用 frame.getBoundingClientRect() 换算到父页面坐标。
const selection_ = {
  active: false,
  dragging: false,
  start: { x: 0, y: 0 },
  // 每次预览页加载铸一次：本次预览里保存的规则同属一组，函数里按编号互取。
  group_id: new_id(),
  container: null,
  shape: "",
  item_count: 0,
  defaults: { color: "", content: "", script: SCRIPT_TEMPLATE, list: LIST_TEMPLATE },
  // script / list 共用 code 输入框：code_type 记当前占用的类型，code_drafts 各留一份草稿，切换不丢内容。
  code_type: "",
  code_drafts: { script: "", list: "" },
  saved: [],
  boxes: [],
  record: null,
  frame: null,
  doc: null,
  toggle: null,
  overlay: null,
  boxes_layer: null,
  box: null,
  outline: null,
  hint: null,
  panel: null,
  name_input: null,
  type_select: null,
  expected_field: null,
  expected_input: null,
  code_field: null,
  code_input: null,
  code_hint: null,
  shape_badge: null,
  feedback: null,
  action_bar: null,
  action_label: null,
  parent_button: null,
  child_button: null,
  // 操作栏沿「祖先链」切换容器：candidates[0] 是框选识别到的最深节点，末尾是 body。
  candidates: [],
  candidate_index: -1,
  // 提取测试面板：函数体在沙箱页（独立 CSP，可用 eval）里跑，本页只负责递 HTML 与渲染输出。
  extract_toggle: null,
  extract_panel: null,
  extract_source: null,
  extract_source_note: null,
  extract_html_view: null,
  extract_code: null,
  extract_run: null,
  extract_status: null,
  extract_output: null,
  extract_frame: null,
  extract_frame_ready: null,
  extract_token: 0,
  extract_pending: null,
};

function new_id() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rect_from(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function is_transparent(value) {
  const match = /rgba?\(([^)]+)\)/i.exec(String(value || ""));
  if (!match) return false;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean);
  return parts.length >= 4 && Number(parts[3]) === 0;
}

// —— 遮罩绘制（遮罩画在预览页自己身上，是 iframe 的兄弟节点）——

// 一次重绘只换算一次：读 iframe 与遮罩的当前位置，之后所有摆放都复用它，
// 避免「逐元素：读 rect → 写 left/top → 再读 rect」把布局反复置脏。
function overlay_offset() {
  const frame_box = selection_.frame.getBoundingClientRect();
  const overlay_box = selection_.overlay.getBoundingClientRect();
  return {
    x: frame_box.left - overlay_box.left,
    y: frame_box.top - overlay_box.top,
    width: overlay_box.width,
    height: overlay_box.height,
  };
}

function to_overlay(box, offset) {
  const delta = offset || overlay_offset();
  return { x: box.left + delta.x, y: box.top + delta.y };
}

function place(element, box, offset) {
  const top_left = to_overlay(box, offset);
  element.style.left = `${top_left.x}px`;
  element.style.top = `${top_left.y}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
  element.hidden = false;
}

function draw_box(rect, offset) {
  place(selection_.box, rect, offset);
}

// 预览文档滚动（含内层可滚动区域）与窗口尺寸变化后，把所有遮罩重新贴回各自的内容上：
// 位置一律由元素当下的 rect 现算，因此滚动 / 重排后照样跟得住。
function reposition_overlay() {
  if (!selection_.active || !selection_.doc) return;
  const offset = overlay_offset();
  const bar = selection_.action_bar;
  const bar_size = { width: bar.offsetWidth, height: bar.offsetHeight };
  const container = selection_.container;
  const container_rect = container && container.isConnected ? container.getBoundingClientRect() : null;
  const saved = selection_.boxes.map((entry) => [entry, entry.element && entry.element.isConnected ? entry.element.getBoundingClientRect() : null]);
  if (container_rect) {
    draw_box(container_rect, offset);
    place(selection_.outline, container_rect, offset);
    place_action_bar(container_rect, offset, bar_size);
  }
  for (const [entry, rect] of saved) {
    if (!rect) {
      entry.node.hidden = true;
      continue;
    }
    place(entry.node, rect, offset);
  }
}

let reposition_pending = false;

function on_layout_change() {
  if (reposition_pending) return;
  reposition_pending = true;
  requestAnimationFrame(() => {
    reposition_pending = false;
    reposition_overlay();
  });
}

function bind_layout() {
  const doc = selection_.doc;
  if (!doc) return;
  doc.addEventListener("scroll", on_layout_change, true);
  window.addEventListener("resize", on_layout_change);
}

function unbind_layout() {
  const doc = selection_.doc;
  if (doc) doc.removeEventListener("scroll", on_layout_change, true);
  window.removeEventListener("resize", on_layout_change);
}

// —— 容器切换操作栏（在框选到的节点与 body 之间沿祖先链移动）——

function ancestor_chain(container) {
  const chain = [];
  for (let node = container; node && node.nodeType === 1; node = node.parentElement) {
    chain.push(node);
    if (node.tagName === "BODY") break;
  }
  return chain.length ? chain : [container];
}

// 选中一个容器：框与轮廓都收到容器上（不是鼠标拉出的那个矩形），再开面板、更新操作栏。
// 带 chain 表示是新的一次框选（重置祖先链），不带则只是操作栏在链上移动游标。
function select_container(container, chain) {
  if (!container) return;
  selection_.container = container;
  if (chain && chain.length) {
    selection_.candidates = chain;
    selection_.candidate_index = 0;
  }
  const rect = container.getBoundingClientRect();
  draw_box(rect);
  place(selection_.outline, rect);
  open_panel(container);
  show_action_bar(rect);
  refresh_extract_source_if_showing_selection();
}

// 撤掉「待保存」的选区（框 / 轮廓 / 操作栏）：保存成功后或被退出框选时调用。
// 调用前调用方已把 container 置空，这里顺手把入参预览里的框选容器一并清掉。
function clear_pending_selection() {
  selection_.box.hidden = true;
  selection_.outline.hidden = true;
  hide_action_bar();
  selection_.candidates = [];
  selection_.candidate_index = -1;
  refresh_extract_source_if_showing_selection();
}

function step_container(offset) {
  const next = selection_.candidate_index + offset;
  if (next < 0 || next >= selection_.candidates.length) return;
  selection_.candidate_index = next;
  select_container(selection_.candidates[next]);
}

function show_action_bar(rect) {
  const bar = selection_.action_bar;
  if (!bar) return;
  const index = selection_.candidate_index;
  bar.hidden = false;
  selection_.action_label.textContent = node_label(selection_.container);
  selection_.child_button.disabled = index <= 0;
  selection_.parent_button.disabled = index >= selection_.candidates.length - 1;
  place_action_bar(rect || selection_.container.getBoundingClientRect());
}

// 贴着容器左缘显示：优先放在容器上方，上方放不下（容器贴到视口顶）时改放下方，
// 上下都放不下（容器占满视口）时才落回容器内部；水平方向夹在遮罩内。
// 容器整个滚出视口时把操作栏收起来，免得它贴边漂在无关内容上。
function place_action_bar(rect, offset, size) {
  const bar = selection_.action_bar;
  const delta = offset || overlay_offset();
  const box = size || { width: bar.offsetWidth, height: bar.offsetHeight };
  const left_edge = rect.left + delta.x;
  const top_edge = rect.top + delta.y;
  const visible = rect.bottom + delta.y > 0 && top_edge < delta.height
    && rect.right + delta.x > 0 && left_edge < delta.width;
  if (!visible) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const above = top_edge - box.height - 4;
  const below = top_edge + rect.height + 4;
  let top = above >= 4 ? above : below;
  if (above < 4 && top + box.height > delta.height - 4) top = top_edge + 4;
  const max_left = Math.max(4, delta.width - box.width - 4);
  bar.style.top = `${top}px`;
  bar.style.left = `${Math.min(Math.max(left_edge, 4), max_left)}px`;
}

function hide_action_bar() {
  if (selection_.action_bar) selection_.action_bar.hidden = true;
}

function build_action_bar() {
  const bar = document.createElement("div");
  bar.className = "preview-select-bar";
  bar.dataset.n = "preview-select-bar";
  bar.hidden = true;

  const label = document.createElement("span");
  label.className = "preview-select-bar-label";
  label.dataset.n = "preview-select-bar-label";

  const child = document.createElement("button");
  child.type = "button";
  child.dataset.n = "preview-select-child";
  child.textContent = "子容器";
  child.addEventListener("click", () => step_container(-1));

  const parent = document.createElement("button");
  parent.type = "button";
  parent.dataset.n = "preview-select-parent";
  parent.textContent = "父容器";
  parent.addEventListener("click", () => step_container(1));

  bar.append(label, child, parent);
  selection_.action_bar = bar;
  selection_.action_label = label;
  selection_.child_button = child;
  selection_.parent_button = parent;
  return bar;
}

// 已保存的框：按编号重画在预览页上。编号是本次预览（group_id）里规则按 created_at 的次序，
// 与 JS 函数规则里 others 的键一一对应；取不到节点的框直接跳过（页面结构可能已变化）。
function draw_saved_boxes() {
  const layer = selection_.boxes_layer;
  if (!layer) return;
  layer.textContent = "";
  selection_.boxes = [];
  const doc = selection_.doc;
  if (!doc) return;
  for (const rule of number_rules(selection_.saved, { group_id: selection_.group_id })) {
    let element = null;
    try { element = rule.selector ? doc.querySelector(rule.selector) : null; } catch { element = null; }
    if (!element) continue;
    const node = document.createElement("div");
    node.className = "preview-select-saved";
    node.dataset.n = "preview-select-saved";
    const label = document.createElement("span");
    label.className = "preview-select-saved-label";
    label.dataset.n = "preview-select-saved-label";
    label.textContent = String(rule.number);
    node.append(label);
    layer.append(node);
    place(node, element.getBoundingClientRect());
    // 存下命中的元素本身：预览文档加载后不再变动，滚动重绘时直接读它的 rect，不用重新查选择器。
    selection_.boxes.push({ number: rule.number, selector: rule.selector, node, element });
  }
}

function clear_saved_boxes() {
  if (selection_.boxes_layer) selection_.boxes_layer.textContent = "";
  selection_.boxes = [];
}

function set_hint(text) {
  selection_.hint.textContent = text;
  selection_.hint.hidden = !text;
}

// —— iframe 内的框选事件（capture 阶段拦截，避免在暂存文档里选中文字或跳转链接）——

function on_mousedown(event) {
  if (!selection_.active || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selection_.dragging = true;
  selection_.start = { x: event.clientX, y: event.clientY };
  hide_action_bar();
  draw_box(rect_from(selection_.start, selection_.start));
}

function on_mousemove(event) {
  if (!selection_.active || !selection_.dragging) return;
  event.preventDefault();
  draw_box(rect_from(selection_.start, { x: event.clientX, y: event.clientY }));
}

function on_mouseup(event) {
  if (!selection_.active || !selection_.dragging) return;
  event.preventDefault();
  event.stopPropagation();
  selection_.dragging = false;
  const rect = rect_from(selection_.start, { x: event.clientX, y: event.clientY });
  draw_box(rect);
  const container = identify_container(selection_.doc, rect);
  if (!container) return;
  select_container(container, ancestor_chain(container));
}

function on_click(event) {
  if (!selection_.active) return;
  event.preventDefault();
  event.stopPropagation();
}

function on_dragstart(event) {
  if (selection_.active) event.preventDefault();
}

const LISTENERS = [
  ["mousedown", on_mousedown],
  ["mousemove", on_mousemove],
  ["mouseup", on_mouseup],
  ["click", on_click],
  ["dragstart", on_dragstart],
];

function bind_listeners() {
  const doc = selection_.doc;
  if (!doc) return;
  for (const [type, handler] of LISTENERS) doc.addEventListener(type, handler, true);
  doc.addEventListener("keydown", on_keydown, true);
}

function unbind_listeners() {
  const doc = selection_.doc;
  if (!doc) return;
  for (const [type, handler] of LISTENERS) doc.removeEventListener(type, handler, true);
  doc.removeEventListener("keydown", on_keydown, true);
}

function on_keydown(event) {
  if (event.key === "Escape") exit_selection();
}

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && selection_.active) exit_selection();
});

// —— 规则面板（纯 DOM 表单；本页无 Timeless）——

function labeled_input(text, name) {
  const label = document.createElement("label");
  label.textContent = text;
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.n = name;
  label.append(input);
  return { label, input };
}

function labeled_textarea(text, name) {
  const label = document.createElement("label");
  label.textContent = text;
  const input = document.createElement("textarea");
  input.dataset.n = name;
  label.append(input);
  return { label, input };
}

function build_panel() {
  const panel = document.createElement("form");
  panel.className = "preview-rule-panel";
  panel.dataset.n = "preview-rule-panel";
  panel.hidden = true;

  const name_field = labeled_input("规则名", "preview-rule-name");
  const expected_field = labeled_input("期望值", "preview-rule-expected");
  const code_field = labeled_textarea("函数体", "preview-rule-code");

  // 框到的内容是「列表」还是「详情」：既在这里提示，也决定函数拿到的数据形态。
  const shape_badge = document.createElement("p");
  shape_badge.className = "preview-rule-shape";
  shape_badge.dataset.n = "preview-rule-shape";
  shape_badge.hidden = true;

  const code_hint = document.createElement("p");
  code_hint.className = "preview-rule-hint";
  code_hint.dataset.n = "preview-rule-hint";
  code_hint.textContent = SCRIPT_HINT;

  const type_label = document.createElement("label");
  type_label.textContent = "条件类型";
  const type_select = document.createElement("select");
  type_select.dataset.n = "preview-rule-type";
  for (const [value, text] of TYPE_OPTIONS) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    type_select.append(option);
  }
  type_label.append(type_select);

  const actions = document.createElement("div");
  actions.className = "preview-rule-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.dataset.n = "preview-rule-cancel";
  cancel.textContent = "取消";
  const save = document.createElement("button");
  save.type = "submit";
  save.dataset.n = "preview-rule-save";
  save.textContent = "保存";
  actions.append(cancel, save);

  const feedback = document.createElement("p");
  feedback.className = "preview-rule-feedback";
  feedback.dataset.n = "preview-rule-feedback";
  feedback.setAttribute("role", "status");

  panel.append(name_field.label, shape_badge, type_label, expected_field.label, code_field.label, code_hint, actions, feedback);
  panel.addEventListener("submit", save_rule);
  type_select.addEventListener("change", on_type_change);
  cancel.addEventListener("click", on_cancel);

  selection_.panel = panel;
  selection_.name_input = name_field.input;
  selection_.type_select = type_select;
  selection_.expected_field = expected_field.label;
  selection_.expected_input = expected_field.input;
  selection_.code_field = code_field.label;
  selection_.code_input = code_field.input;
  selection_.code_hint = code_hint;
  selection_.shape_badge = shape_badge;
  selection_.feedback = feedback;
  return panel;
}

// 期望值按类型预填：颜色取识别节点的计算颜色（文字透明时退用背景色），内容取折叠空白后的文本片段；
// JS 函数给一段可用模板。形态徽标来自 inspect_content：列表 / 详情决定函数拿到的数据形态。
function open_panel(container) {
  const view = container.ownerDocument.defaultView;
  const styles = view.getComputedStyle(container);
  const color = styles.color || "";
  const background = styles.backgroundColor || "";
  const text = String(container.textContent || "").replace(/\s+/g, " ").trim();
  const info = inspect_content(container);
  selection_.shape = info.shape;
  selection_.item_count = info.item_count;
  selection_.defaults = {
    color: is_transparent(color) ? background : color,
    content: text.length > 80 ? text.slice(0, 80) : text,
    script: SCRIPT_TEMPLATE,
    list: LIST_TEMPLATE,
  };
  selection_.name_input.value = `${selection_.record.title || "页面"} - ${node_label(container)}`;
  selection_.type_select.value = "color";
  // 新框用新草稿：函数体清空、code_type 复位，切到写函数的类型时预填模板。
  selection_.code_input.value = "";
  selection_.code_type = "";
  selection_.code_drafts = { script: "", list: "" };
  selection_.shape_badge.textContent = describe_shape(info);
  selection_.shape_badge.hidden = false;
  selection_.feedback.textContent = "";
  on_type_change();
  selection_.panel.hidden = false;
  set_hint("确认容器与条件后保存规则，也可用操作栏切换父 / 子容器，按 Esc 退出框选");
}

function on_type_change() {
  const type = selection_.type_select.value;
  const is_code = CODE_TYPES.has(type);
  // 切走时先把当前函数体存回草稿（script / list 各一份），切回来不丢用户写的内容。
  if (CODE_TYPES.has(selection_.code_type) && selection_.code_type !== type) {
    selection_.code_drafts[selection_.code_type] = selection_.code_input.value;
  }
  selection_.code_type = is_code ? type : "";
  selection_.expected_field.hidden = is_code;
  selection_.code_field.hidden = !is_code;
  selection_.code_hint.hidden = !is_code;
  if (is_code) {
    const draft = selection_.code_drafts[type];
    selection_.code_input.value = draft && draft.trim() ? draft : selection_.defaults[type] || "";
    selection_.code_hint.textContent = type === "list" ? LIST_HINT : SCRIPT_HINT;
    return;
  }
  selection_.expected_input.value = selection_.defaults[type] || "";
}

// 逐框保存：保存成功后把该框画上编号，可继续框下一个。
async function save_rule(event) {
  event.preventDefault();
  const container = selection_.container;
  if (!container) return;
  const type = selection_.type_select.value;
  const is_code = CODE_TYPES.has(type);
  const code = is_code ? selection_.code_input.value : "";
  if (is_code && !code.trim()) {
    selection_.feedback.textContent = type === "list" ? "请填写取键函数体" : "请填写 JS 函数体";
    return;
  }
  const name = selection_.name_input.value.trim() || node_label(container);
  // 规则是纯 JSON、自包含的（无函数、无元素引用），将来可直接 POST 给后端执行。
  const rule = {
    id: new_id(),
    name,
    type,
    expected: is_code ? "" : selection_.expected_input.value,
    selector: build_selector(container),
    node: node_label(container),
    hostname: hostname_of(selection_.record.url),
    source_url: selection_.record.url || "",
    source_record_id: selection_.record.id,
    group_id: selection_.group_id,
    shape: selection_.shape,
    item_count: selection_.item_count,
    created_at: Date.now(),
  };
  if (is_code) rule.code = code;
  // 列表对比的基线在首次检测时才记录（扩展页 CSP 不允许 eval，预览页跑不了取键函数）。
  if (type === "list") rule.baseline = null;
  try {
    // 先读后写：直接 set 会覆盖已有规则。
    const saved = await chrome.storage.local.get(detection_rules_key);
    const rules = Array.isArray(saved && saved[detection_rules_key]) ? saved[detection_rules_key].slice() : [];
    rules.push(rule);
    await chrome.storage.local.set({ [detection_rules_key]: rules });
    selection_.saved.push(rule);
    // 同一个框不重复登记：保存后撤掉待保存的选区，改由编号框表示（它跟着内容滚动重绘）。
    if (selection_.container === container) {
      selection_.container = null;
      clear_pending_selection();
    }
    selection_.feedback.textContent = `已保存「${name}」`;
    draw_saved_boxes();
  } catch (error) {
    selection_.feedback.textContent = `保存失败：${error.message}`;
  }
}

function on_cancel(event) {
  event.preventDefault();
  exit_selection();
}

// —— 框选模式切换 ——

function enter_selection() {
  if (!selection_.doc) return;
  selection_.active = true;
  selection_.container = null;
  selection_.toggle.setAttribute("aria-pressed", "true");
  selection_.toggle.textContent = "退出框选";
  selection_.overlay.hidden = false;
  selection_.panel.hidden = true;
  clear_pending_selection();
  set_hint("在预览中拖拽框选要检测的内容块，用操作栏切换父 / 子容器，按 Esc 退出");
  selection_.doc.documentElement.style.cursor = "crosshair";
  selection_.doc.documentElement.style.userSelect = "none";
  // 重绘本组已保存的框：编号与函数里 others 的键始终一致。
  draw_saved_boxes();
  bind_listeners();
  bind_layout();
}

function exit_selection() {
  if (selection_.doc) {
    selection_.doc.documentElement.style.cursor = "";
    selection_.doc.documentElement.style.userSelect = "";
  }
  unbind_listeners();
  unbind_layout();
  selection_.active = false;
  selection_.dragging = false;
  selection_.container = null;
  selection_.toggle.setAttribute("aria-pressed", "false");
  selection_.toggle.textContent = "框选";
  selection_.overlay.hidden = true;
  selection_.panel.hidden = true;
  clear_pending_selection();
  // 退出时清空编号与草稿；存量规则仍在 group_id 组里，下次进入框选重绘。
  selection_.code_input.value = "";
  selection_.code_type = "";
  selection_.code_drafts = { script: "", list: "" };
  clear_saved_boxes();
  set_hint("");
}

function toggle_selection() {
  if (selection_.active) exit_selection();
  else enter_selection();
}

function build_toggle() {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "preview-select-toggle";
  toggle.dataset.n = "preview-select-toggle";
  toggle.textContent = "框选";
  toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", toggle_selection);
  selection_.toggle = toggle;
  return toggle;
}

function build_overlay() {
  const overlay = document.createElement("div");
  overlay.className = "preview-select-overlay";
  overlay.dataset.n = "preview-select-overlay";
  overlay.hidden = true;
  const box = document.createElement("div");
  box.className = "preview-select-box";
  box.dataset.n = "preview-select-box";
  box.hidden = true;
  const outline = document.createElement("div");
  outline.className = "preview-select-container";
  outline.dataset.n = "preview-select-container";
  outline.hidden = true;
  const boxes = document.createElement("div");
  boxes.className = "preview-select-boxes";
  boxes.dataset.n = "preview-select-boxes";
  overlay.append(boxes, box, outline, build_action_bar());
  selection_.overlay = overlay;
  selection_.boxes_layer = boxes;
  selection_.box = box;
  selection_.outline = outline;
  return overlay;
}

function build_hint() {
  const hint = document.createElement("div");
  hint.className = "preview-select-hint";
  hint.dataset.n = "preview-select-hint";
  hint.hidden = true;
  selection_.hint = hint;
  return hint;
}

// —— 提取测试：DOM html → JS 提取函数 → 输出可视化 ——

function set_extract_status(text, error) {
  selection_.extract_status.textContent = text;
  selection_.extract_status.classList.toggle("is-error", Boolean(error));
}

// 数据源 → 待解析的 HTML 字符串。整页用暂存记录的原始 HTML（一份真正的「完整 html」）；
// 框选容器用当前待保存选区的 outerHTML（只测你关心的那一块）。
function extract_html(source) {
  if (source === "selection") return selection_.container ? selection_.container.outerHTML : "";
  return String((selection_.record && selection_.record.html) || "");
}

// 入参预览：函数体拿到的就是这段 HTML。默认显示整页；切到「框选容器」显示那个容器的 outerHTML。
function refresh_extract_source() {
  const source = selection_.extract_source.value;
  const html = extract_html(source);
  const truncated = html.length > EXTRACT_HTML_LIMIT;
  selection_.extract_html_view.textContent = html
    ? (truncated ? `${html.slice(0, EXTRACT_HTML_LIMIT)}\n…（预览已截断，运行仍用完整 HTML）` : html)
    : (source === "selection" ? "（暂无内容：先在预览里框选一个容器）" : "（整页 HTML 为空）");
  selection_.extract_source_note.textContent = `入参 HTML · ${EXTRACT_SOURCES[source]} · ${html.length} 字符`;
}

// 框选容器变化时只在这种组合下重写预览，免得每次切换父 / 子容器都重刷一遍整页 HTML。
function refresh_extract_source_if_showing_selection() {
  if (!selection_.extract_panel || selection_.extract_panel.hidden) return;
  if (selection_.extract_source.value !== "selection") return;
  refresh_extract_source();
}

// 沙箱页只加载一次，之后复用；被超时重置过才会再建。
function ensure_extract_frame() {
  if (selection_.extract_frame) return selection_.extract_frame_ready;
  const frame = document.createElement("iframe");
  frame.className = "preview-extract-frame";
  frame.dataset.n = "preview-extract-frame";
  frame.title = "提取执行器";
  // 不含 allow-same-origin：不透明源，宿主读不到它的文档，来回只能走 postMessage。
  frame.setAttribute("sandbox", "allow-scripts");
  selection_.extract_frame = frame;
  selection_.extract_frame_ready = new Promise((resolve) => {
    frame.addEventListener("load", () => resolve(frame), { once: true });
  });
  frame.src = new URL("./extract.sandbox.html", import.meta.url).href;
  selection_.extract_panel.append(frame);
  return selection_.extract_frame_ready;
}

function drop_extract_frame() {
  if (selection_.extract_frame) selection_.extract_frame.remove();
  selection_.extract_frame = null;
  selection_.extract_frame_ready = null;
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.dm_extract !== "result") return;
  const frame = selection_.extract_frame;
  if (!frame || event.source !== frame.contentWindow) return;
  const pending = selection_.extract_pending;
  if (!pending || pending.token !== data.token) return;
  clearTimeout(pending.timer);
  selection_.extract_pending = null;
  pending.resolve(data);
});

function ask_sandbox(frame, html, code) {
  return new Promise((resolve) => {
    selection_.extract_token += 1;
    const pending = { token: selection_.extract_token, resolve, timer: 0 };
    pending.timer = setTimeout(() => {
      if (selection_.extract_pending !== pending) return;
      selection_.extract_pending = null;
      // 死循环会把沙箱页卡死，连回消息都发不出来 —— 只能整个换掉再继续用。
      drop_extract_frame();
      resolve(null);
    }, EXTRACT_TIMEOUT);
    selection_.extract_pending = pending;
    frame.contentWindow.postMessage({ dm_extract: "run", token: pending.token, html: html, code: code }, "*");
  });
}

async function run_extract() {
  if (selection_.extract_pending) return;
  const source = selection_.extract_source.value;
  // 入参预览与实际送给沙箱的必须是同一份 HTML。
  refresh_extract_source();
  const html = extract_html(source);
  if (!html) {
    set_extract_status(source === "selection" ? "先在预览里框选一个容器，再运行" : "整页 HTML 为空", true);
    render_extract_output("");
    return;
  }
  const code = selection_.extract_code.value;
  if (!code.trim()) {
    set_extract_status("请填写函数体（需要 return）", true);
    render_extract_output("");
    return;
  }
  const frame = await ensure_extract_frame();
  if (selection_.extract_frame !== frame) return;
  selection_.extract_run.disabled = true;
  set_extract_status("运行中…");
  const reply = await ask_sandbox(frame, html, code);
  selection_.extract_run.disabled = false;
  if (!reply) {
    set_extract_status("执行超时（函数体可能死循环），执行器已重置", true);
    render_extract_output("");
    return;
  }
  if (!reply.ok) {
    set_extract_status(`执行出错：${reply.error || "未知错误"}`, true);
    render_extract_output("");
    return;
  }
  const truncated = reply.truncated ? "（已截断）" : "";
  set_extract_status(`入参 ${EXTRACT_SOURCES[source]} · ${html.length} 字符 ｜ 行为 DOMParser 解析 + 执行函数 · ${reply.elapsed} ms ｜ 输出 ${reply.size} 字符${truncated}`);
  render_extract_output(reply.json);
}

function render_extract_output(json) {
  const box = selection_.extract_output;
  if (!box) return;
  box.textContent = "";
  if (!json) return;
  const table = extract_table(json);
  if (table) box.append(table);
  const pre = document.createElement("pre");
  pre.className = "preview-extract-json";
  pre.dataset.n = "preview-extract-json";
  pre.textContent = json;
  box.append(pre);
}

// 输出是「对象数组」且字段都是基本类型时，额外渲染成表格 —— 提取列表时这才是想看的形态。
// 不满足就返回 null，只显示 JSON（嵌套结构、非数组、列过多都不硬凑）。
function extract_table(json) {
  let rows = null;
  try { rows = JSON.parse(json); } catch { return null; }
  if (!Array.isArray(rows) || !rows.length || rows.length > EXTRACT_ROW_LIMIT) return null;
  const columns = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    for (const value of Object.values(row)) {
      if (value !== null && typeof value === "object") return null;
    }
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
    if (columns.length > 12) return null;
  }
  if (!columns.length) return null;
  const table = document.createElement("table");
  table.className = "preview-extract-table";
  table.dataset.n = "preview-extract-table";
  const head = document.createElement("tr");
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.textContent = column;
    head.append(cell);
  }
  table.append(head);
  for (const row of rows) {
    const line = document.createElement("tr");
    for (const column of columns) {
      const cell = document.createElement("td");
      const value = row[column];
      cell.textContent = value === null || value === undefined ? "" : String(value);
      line.append(cell);
    }
    table.append(line);
  }
  return table;
}

function toggle_extract() {
  const open = selection_.extract_panel.hidden;
  selection_.extract_panel.hidden = !open;
  selection_.extract_toggle.setAttribute("aria-pressed", open ? "true" : "false");
  // 每次展开都重算入参预览：期间可能又框了别的容器。
  if (open) refresh_extract_source();
}

function build_extract_toggle() {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "preview-select-toggle";
  toggle.dataset.n = "preview-extract-toggle";
  toggle.textContent = "提取测试";
  toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", toggle_extract);
  selection_.extract_toggle = toggle;
  return toggle;
}

function build_extract_panel() {
  const panel = document.createElement("section");
  panel.className = "preview-extract";
  panel.dataset.n = "preview-extract";
  panel.hidden = true;

  const row = document.createElement("div");
  row.className = "preview-extract-row";

  const source_label = document.createElement("label");
  source_label.textContent = "数据源";
  const source = document.createElement("select");
  source.dataset.n = "preview-extract-source";
  for (const [value, text] of Object.entries(EXTRACT_SOURCES)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    source.append(option);
  }
  source_label.append(source);
  source.addEventListener("change", refresh_extract_source);

  const run = document.createElement("button");
  run.type = "button";
  run.dataset.n = "preview-extract-run";
  run.textContent = "运行";
  run.addEventListener("click", () => { run_extract(); });

  const close = document.createElement("button");
  close.type = "button";
  close.dataset.n = "preview-extract-close";
  close.textContent = "收起";
  close.addEventListener("click", toggle_extract);

  row.append(source_label, run, close);

  // 入参预览：默认就是整页 HTML，切到框选容器就换成那个容器的 outerHTML。
  const source_note = document.createElement("p");
  source_note.className = "preview-extract-note";
  source_note.dataset.n = "preview-extract-source-note";
  const html_view = document.createElement("pre");
  html_view.className = "preview-extract-html";
  html_view.dataset.n = "preview-extract-html";

  const code_label = document.createElement("label");
  code_label.className = "preview-extract-code";
  code_label.textContent = "函数体";
  const code = document.createElement("textarea");
  code.dataset.n = "preview-extract-code";
  code.spellcheck = false;
  code.value = EXTRACT_TEMPLATE;
  code_label.append(code);

  const hint = document.createElement("p");
  hint.className = "preview-extract-hint";
  hint.dataset.n = "preview-extract-hint";
  hint.textContent = EXTRACT_HINT;

  const status = document.createElement("p");
  status.className = "preview-extract-status";
  status.dataset.n = "preview-extract-status";
  status.setAttribute("role", "status");

  const output = document.createElement("div");
  output.className = "preview-extract-output";
  output.dataset.n = "preview-extract-output";

  panel.append(row, source_note, html_view, code_label, hint, status, output);
  selection_.extract_panel = panel;
  selection_.extract_source = source;
  selection_.extract_source_note = source_note;
  selection_.extract_html_view = html_view;
  selection_.extract_code = code;
  selection_.extract_run = run;
  selection_.extract_status = status;
  selection_.extract_output = output;
  return panel;
}

function render_record(record) {
  const root = document.querySelector('[data-n="preview-root"]');
  document.title = `${record.title} - 页面预览`;
  root.textContent = "";
  selection_.record = record;

  const heading = document.createElement("header");
  heading.className = "preview-heading";
  heading.dataset.n = "preview-heading";

  const title = document.createElement("span");
  title.className = "preview-record-title";
  title.dataset.n = "preview-record-title";
  title.textContent = record.title;
  title.title = record.url || "";

  const url = document.createElement("span");
  url.className = "preview-record-url";
  url.dataset.n = "preview-record-url";
  url.textContent = record.url || "";

  const toggle = build_toggle();

  const frame = document.createElement("iframe");
  frame.className = "preview-frame";
  frame.dataset.n = "preview-frame";
  frame.title = `暂存页面：${record.title}`;
  frame.sandbox = "allow-same-origin";
  frame.srcdoc = build_preview_document(record);
  selection_.frame = frame;
  // srcdoc 导航会替换初始的 about:blank 文档，只能在 load 之后拿 contentDocument。
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    if (doc) {
      selection_.doc = doc;
      return;
    }
    toggle.disabled = true;
    toggle.textContent = "框选不可用";
    toggle.title = "无法访问预览文档，框选不可用";
  });

  const stage = document.createElement("div");
  stage.className = "preview-stage";
  stage.dataset.n = "preview-stage";
  stage.append(frame, build_overlay(), build_hint(), build_panel());

  heading.append(title, url, toggle, build_extract_toggle());
  root.append(heading, stage, build_extract_panel());
}

// 本次预览（group_id）已保存的规则：进入框选时按编号重绘，保存时追加。
async function load_saved_rules() {
  try {
    const saved = await chrome.storage.local.get(detection_rules_key);
    const rules = Array.isArray(saved && saved[detection_rules_key]) ? saved[detection_rules_key] : [];
    selection_.saved = rules.filter((rule) => rule && typeof rule === "object" && rule.group_id === selection_.group_id);
  } catch {
    selection_.saved = [];
  }
}

model.ready().then(async () => {
  const root = document.querySelector('[data-n="preview-root"]');
  const record = model.records.find((item) => item.id === id);
  if (!record) {
    root.textContent = id ? "未找到对应的暂存记录，可能已被删除。" : "缺少记录 id，请从扩展弹窗的暂存列表打开预览。";
    return;
  }
  await load_saved_rules();
  render_record(record);
}).catch((error) => {
  document.querySelector('[data-n="preview-root"]').textContent = `加载预览失败：${error.message}`;
});
