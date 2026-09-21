import { build_clip_document, clips_key, normalize_clip_records, size_clip_fragment, verify_no_external_refs } from "./clip.model.js";

// 剪藏结果页：按 URL 中的 id 取一条剪藏记录。
// 产出物是自包含片段（无 style/link/script、无外链、图片已内联），所以预览用 sandbox="" 的
// srcdoc iframe —— 没有 allow-scripts，也就没有任何执行面；不给 allow-same-origin，宿主拿不到
// 它的文档，产出物更不可能反过来影响这份结果页。
const params = new URLSearchParams(location.search);
const id = params.get("id");

const root = document.querySelector('[data-n="clip-root"]');

const FEEDBACK_MS = 2000;

let feedback_timer = 0;

function element(tag, class_name, n) {
  const node = document.createElement(tag);
  if (class_name) node.className = class_name;
  if (n) node.dataset.n = n;
  return node;
}

function format_size(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function stats_text(record) {
  const parts = [`${record.element_count} 个元素`];
  if (record.width && record.height) parts.push(`${record.width}×${record.height}`);
  if (record.image_count) parts.push(record.image_missing ? `图片 ${record.image_count}（缺失 ${record.image_missing}）` : `图片 ${record.image_count}`);
  if (record.byte_size) parts.push(format_size(record.byte_size));
  return parts.join(" · ");
}

function render_empty(message) {
  const empty = element("div", "clip-empty", "clip-empty");
  empty.textContent = message;
  root.append(empty);
}

// 一个带标签的数字输入（标签在左、输入框在右）。
function size_field(label_text, n, value) {
  const label = element("label", "clip-size-field", n);
  const text = element("span", "clip-size-label");
  text.textContent = label_text;
  const input = element("input", "clip-size-input", `${n}-input`);
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.placeholder = "自适应";
  input.value = value ? String(value) : "";
  label.append(text, input);
  return { label, input };
}

function render(record) {
  document.title = `${record.title} - 剪藏结果`;

  const heading = element("header", "clip-heading", "clip-heading");
  const title = element("span", "clip-record-title", "clip-record-title");
  title.textContent = record.title;
  title.title = record.title;
  const url = element("span", "clip-record-url", "clip-record-url");
  url.textContent = record.url || "";
  url.title = record.url || "";
  const stats = element("span", "clip-stats", "clip-stats");
  stats.textContent = stats_text(record);
  heading.append(title, url, stats);

  const feedback = element("p", "clip-feedback", "clip-feedback");
  feedback.setAttribute("role", "status");

  function say(message) {
    feedback.textContent = message;
    clearTimeout(feedback_timer);
    feedback_timer = setTimeout(() => { feedback.textContent = ""; }, FEEDBACK_MS);
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      say(`${label}已复制（${text.length.toLocaleString()} 个字符）`);
    } catch (error) {
      say(`${label}复制失败：${error.message}`);
    }
  }

  // —— 尺寸：默认记录原尺寸，留空的那一维随宿主自适应 ——
  // 产出片段的最外层没有冻结宽高（见 clip.model.js 的 apply_diff），所以尺寸是这里现写上去的。
  const width_field = size_field("宽", "clip-size-width", record.width);
  const height_field = size_field("高", "clip-size-height", record.height);
  const width_input = width_field.input;
  const height_input = height_field.input;
  const size_reset = element("button", "", "clip-size-reset");
  size_reset.type = "button";
  size_reset.textContent = "原尺寸";
  size_reset.title = `恢复抓取时的尺寸（${record.width}×${record.height}）`;
  size_reset.disabled = !record.width && !record.height;
  const size_note = element("span", "clip-size-note");
  size_note.textContent = "留空 = 随宿主自适应";
  const size_row = element("div", "clip-size", "clip-size");
  size_row.append(width_field.label, height_field.label, size_reset, size_note);

  const actions = element("div", "clip-actions", "clip-actions");
  const copy_fragment = element("button", "", "clip-copy-fragment");
  copy_fragment.type = "button";
  copy_fragment.textContent = "复制片段";
  copy_fragment.title = "复制可直接嵌进任意 HTML 的片段";
  copy_fragment.addEventListener("click", () => copy(sized(), "片段"));
  const copy_document = element("button", "", "clip-copy-document");
  copy_document.type = "button";
  copy_document.textContent = "复制完整文档";
  copy_document.title = "复制一份完整的 HTML 文档";
  copy_document.addEventListener("click", () => copy(document_html(), "完整文档"));

  const self_check = element("p", "clip-self-check", "clip-self-check");

  actions.append(copy_fragment, copy_document, self_check, feedback);

  const frame = element("iframe", "clip-frame", "clip-frame");
  frame.title = `剪藏片段：${record.title}`;
  frame.setAttribute("sandbox", "");

  const stage = element("div", "clip-stage", "clip-stage");
  stage.append(frame);

  const source = element("div", "clip-source", "clip-source");
  const source_head = element("div", "clip-source-head", "clip-source-head");
  const source_title = element("span", "clip-source-title", "clip-source-title");
  source_title.textContent = "源码（片段）";
  source_head.append(source_title);
  const textarea = element("textarea", "", "clip-source-html");
  textarea.readOnly = true;
  textarea.spellcheck = false;
  source.append(source_head, textarea);

  function sized() {
    return size_clip_fragment(record.html, width_input.value, height_input.value);
  }

  function document_html() {
    return build_clip_document({ ...record, html: sized() }, { full: true });
  }

  // 预览 / 源码 / 复制三处同源：改尺寸就整份重算，免得「看到的是一个版本、复制到的是另一个」。
  function refresh() {
    const fragment = sized();
    textarea.value = fragment;
    frame.srcdoc = document_html();
    // 自检：产出物的硬线（无外链、无 style/script/iframe、无内联事件），落库前 SW 也验一遍。
    const checked = verify_no_external_refs(fragment);
    self_check.classList.toggle("is-error", !checked.ok);
    self_check.textContent = checked.ok
      ? "自检通过：无外部引用、无可执行内容"
      : `自检未通过：${checked.hits.map((hit) => hit.label).join("、")}`;
  }

  for (const input of [width_input, height_input]) input.addEventListener("input", refresh);
  size_reset.addEventListener("click", () => {
    width_input.value = record.width ? String(record.width) : "";
    height_input.value = record.height ? String(record.height) : "";
    refresh();
  });
  refresh();

  root.append(heading, actions, size_row, stage, source);
}

async function main() {
  if (!id) {
    render_empty("缺少剪藏记录 id，请从扩展弹窗的剪藏列表打开结果页。");
    return;
  }
  let records = [];
  try {
    const saved = await chrome.storage.local.get(clips_key);
    records = normalize_clip_records(saved?.[clips_key]);
  } catch (error) {
    render_empty(`读取剪藏记录失败：${error.message}`);
    return;
  }
  const record = records.find((item) => item.id === id);
  if (!record) {
    render_empty("找不到这条剪藏记录，可能已被删除。");
    return;
  }
  render(record);
}

main();
