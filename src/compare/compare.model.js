export const comparison_records_key = "comparison-records";
export const comparison_group_key = "comparison-group";
export const comparison_groups_key = "comparison-groups";
export const default_comparison_group = "分组 1";

// 分组是固定存在的：分组名单独持久化，不随组内记录清空而消失，只有显式删除才会移除。
export function normalize_group_names(names) {
  const seen = new Set();
  const result = [];
  for (const name of Array.isArray(names) ? names : []) {
    const value = typeof name === "string" ? name.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function group_comparison_records(records) {
  const groups = [];
  const index = new Map();
  for (const record of records) {
    const name = typeof record.group === "string" && record.group.trim() ? record.group : default_comparison_group;
    let group = index.get(name);
    if (!group) {
      group = { name, records: [] };
      index.set(name, group);
      groups.push(group);
    }
    group.records.push(record);
  }
  return groups;
}

function element_attributes(element) {
  return Array.from(element.attributes)
    .filter((attribute) => !attribute.name.startsWith("data-compare-") && attribute.name !== "title")
    .map((attribute) => `${attribute.name}=${attribute.value}`).sort().join("|");
}

function structural_signature(element) {
  return `${element.tagName}|${element_attributes(element)}`;
}

function direct_text(element) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

function element_signature(element) {
  return `${structural_signature(element)}|${direct_text(element)}`;
}

// 叶子元素（不含子元素）可直接按文本做更细粒度的差异定位。
function leaf_text(element) {
  if (element.children.length > 0) return null;
  return element.textContent || "";
}

// head 内的 style/title/link/meta 等是渲染元数据，改动其文本或 title 属性会破坏样式与标题，
// 因此差异标记只作用于 body 中的可见内容元素。
const non_content_tags = new Set(["SCRIPT", "NOSCRIPT", "TEMPLATE", "STYLE", "TITLE", "LINK", "META", "BASE"]);
function is_content_element(element) {
  if (non_content_tags.has(element.tagName)) return false;
  return !element.closest("head");
}

// 返回 a 相对 b 的最长公共前后缀之外的差异区间 [start, end)。
function diff_range(a, b) {
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && a[start] === b[start]) start += 1;
  let end = a.length;
  let end_b = b.length;
  while (end > start && end_b > start && a[end - 1] === b[end - 1]) { end -= 1; end_b -= 1; }
  return { start, end };
}

function merge_ranges(ranges) {
  const sorted = ranges.filter((range) => range.start < range.end).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

function wrap_text_ranges(element, ranges, detail) {
  const doc = element.ownerDocument;
  const text = element.textContent || "";
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor) fragment.append(doc.createTextNode(text.slice(cursor, start)));
    const mark = doc.createElement("mark");
    mark.setAttribute("data-compare-text-diff", "");
    if (detail) mark.setAttribute("data-compare-detail", detail);
    mark.textContent = text.slice(start, end);
    fragment.append(mark);
    cursor = end;
  }
  if (cursor < text.length) fragment.append(doc.createTextNode(text.slice(cursor)));
  element.textContent = "";
  element.append(fragment);
}

// —— 树对齐：用 LCS 在每层兄弟间做相似度匹配，避免插入/删除导致位置漂移。——

function child_key(element) {
  return {
    tag: element.tagName,
    structural: structural_signature(element),
    text: (element.textContent || "").replace(/\s+/g, " ").trim(),
  };
}

// 两个子节点是否对齐为同一元素：同标签，且（结构一致 或 非空文本一致）。
function match_keys(a, b) {
  if (a.tag !== b.tag) return false;
  if (a.structural === b.structural) return true;
  return a.text !== "" && a.text === b.text;
}

// 最长公共子序列：match(i, j) 判断第 i 个与第 j 个是否匹配，返回匹配的索引对 [i, j]。
function lcs(length_a, length_b, match) {
  const dp = Array.from({ length: length_a + 1 }, () => new Array(length_b + 1).fill(0));
  for (let i = 1; i <= length_a; i += 1) {
    for (let j = 1; j <= length_b; j += 1) {
      dp[i][j] = match(i - 1, j - 1) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const pairs = [];
  let i = length_a;
  let j = length_b;
  while (i > 0 && j > 0) {
    if (match(i - 1, j - 1)) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs.reverse();
}

// 将第 doc_index 页的兄弟序列 list 对齐到已有模板 template 上。
// template 的每个槽位是长度 N 的数组（元素或 null），返回对齐后的新模板。
function align_two(template, list, doc_index, n) {
  const reps = template.map((slot) => slot.find((element) => element !== null));
  const rep_keys = reps.map(child_key);
  const list_keys = list.map(child_key);
  const pairs = lcs(rep_keys.length, list_keys.length, (i, j) => match_keys(rep_keys[i], list_keys[j]));
  const pair_by_template = new Map(pairs.map(([ti, li]) => [ti, li]));

  const result = [];
  let li = 0;
  for (let ti = 0; ti < template.length; ti += 1) {
    if (pair_by_template.has(ti)) {
      const matched_li = pair_by_template.get(ti);
      while (li < matched_li) {
        const slot = new Array(n).fill(null);
        slot[doc_index] = list[li];
        result.push(slot);
        li += 1;
      }
      const slot = template[ti].slice();
      slot[doc_index] = list[li];
      result.push(slot);
      li += 1;
    } else {
      result.push(template[ti].slice());
    }
  }
  while (li < list.length) {
    const slot = new Array(n).fill(null);
    slot[doc_index] = list[li];
    result.push(slot);
    li += 1;
  }
  return result;
}

// 对齐各页同一父节点下的子节点列表，返回槽位数组（每个槽位是长度 N 的元素/null 数组）。
function align_children(children_lists) {
  const n = children_lists.length;
  let template = null;
  for (let i = 0; i < n; i += 1) {
    const list = children_lists[i];
    if (!list) continue;
    if (template === null) {
      template = list.map((element) => {
        const slot = new Array(n).fill(null);
        slot[i] = element;
        return slot;
      });
    } else {
      template = align_two(template, list, i, n);
    }
  }
  return template || [];
}

// —— 逐对比较：第 i 条记录永远以第 i-1 条为基准，标注当前页并产出新增/移除清单。 ——

function parse_record(record) {
  const document = new DOMParser().parseFromString(record.html, "text/html");
  document.querySelectorAll("script,noscript,template").forEach((element) => element.remove());
  return document;
}

function node_path(element) {
  const parts = [];
  for (let node = element; node && node.nodeType === Node.ELEMENT_NODE; node = node.parentElement) {
    if (node.tagName === "HTML") break;
    parts.unshift(node.tagName.toLowerCase() + (node.id ? `#${node.id}` : ""));
  }
  return parts.join(" > ");
}

// 节点在简报中的描述信息：标签、id、类名、文本片段与所在路径。
function node_info(element) {
  return {
    tag: element.tagName.toLowerCase(),
    id: element.id || "",
    classes: Array.from(element.classList),
    text: (leaf_text(element) ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30),
    path: node_path(element),
  };
}

export function describe_node(info) {
  if (info.id) return `${info.tag}#${info.id}`;
  if (info.classes.length) return `${info.tag}.${info.classes[0]}`;
  return info.tag;
}

// 点击遮罩后的说明弹窗内容截断：完整文本/属性值可能极长，只保留可读片段。
function detail_snippet(value, limit = 160) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// 差异明细以 JSON 存入 data-compare-detail：iframe 文档随 srcdoc 序列化，属性是最可靠的载体。
function detail_payload(element, extra) {
  return JSON.stringify({ info: node_info(element), ...extra });
}

// 变更元素的属性级差异：新增/移除/取值变化，忽略对比流程自身注入的 data-compare-*。
function attribute_changes(prev_element, curr_element) {
  const prev_attributes = new Map(
    Array.from(prev_element.attributes)
      .filter((attribute) => !attribute.name.startsWith("data-compare-"))
      .map((attribute) => [attribute.name, attribute.value]),
  );
  const changes = [];
  for (const attribute of curr_element.attributes) {
    if (attribute.name.startsWith("data-compare-")) continue;
    if (!prev_attributes.has(attribute.name)) changes.push({ name: attribute.name, to: detail_snippet(attribute.value, 120), added: true });
    else if (prev_attributes.get(attribute.name) !== attribute.value) {
      changes.push({ name: attribute.name, from: detail_snippet(prev_attributes.get(attribute.name), 120), to: detail_snippet(attribute.value, 120) });
    }
  }
  for (const [name, value] of prev_attributes) {
    if (!curr_element.hasAttribute(name)) changes.push({ name, from: detail_snippet(value, 120), removed: true });
  }
  return changes;
}

// 变更明细：属性差异 + 直接文本变化 + 子元素数量变化（属性相同时差异可能在更深处）。
// 必须在写入标注属性之前计算，避免把流程自身注入的 title/data-compare-* 计入差异。
function change_details(prev_element, curr_element) {
  const details = {};
  const attributes = attribute_changes(prev_element, curr_element);
  if (attributes.length) details.attributes = attributes;
  const prev_text = direct_text(prev_element);
  const curr_text = direct_text(curr_element);
  if (prev_text !== curr_text) details.text = { from: detail_snippet(prev_text), to: detail_snippet(curr_text) };
  if (prev_element.children.length !== curr_element.children.length) details.children = { from: prev_element.children.length, to: curr_element.children.length };
  return details;
}

// 双方对齐为同一元素但签名不同 → 变更；叶子文本做字符级高亮（参考 = 基准页文本）。
function annotate_changed_pair(prev_element, curr_element, baseline_label) {
  if (!is_content_element(curr_element)) return;
  if (element_signature(curr_element) === element_signature(prev_element)) return;
  const title = `与 ${baseline_label} 存在差异`;
  if (structural_signature(prev_element) === structural_signature(curr_element)) {
    const prev_text = leaf_text(prev_element);
    const curr_text = leaf_text(curr_element);
    if (prev_text !== null && curr_text !== null) {
      const ranges = merge_ranges([diff_range(curr_text, prev_text)]);
      if (ranges.length) {
        const detail = detail_payload(curr_element, { kind: "text", baseline: baseline_label, from: detail_snippet(prev_text), to: detail_snippet(curr_text) });
        wrap_text_ranges(curr_element, ranges, detail);
        curr_element.setAttribute("title", title);
        return;
      }
    }
  }
  const detail = detail_payload(curr_element, { kind: "changed", baseline: baseline_label, ...change_details(prev_element, curr_element) });
  curr_element.setAttribute("data-compare-changed", "");
  curr_element.setAttribute("title", title);
  curr_element.setAttribute("data-compare-detail", detail);
}

// 广度优先比较一对文档：同层兄弟先对齐、再逐层下钻，新增/移除按层级顺序记录。
// 基准（prev）只读；标注与删除渲染只写入当前页（curr）。
// inherited 表示所在子树已整体记为新增/移除，内部节点不再重复记录。
function diff_pair(prev_document, curr_document, baseline_label) {
  const added = [];
  const removed = [];
  // 被删节点克隆回当前页的插入任务统一延后执行，避免影响遍历中的对齐与叶子文本判断。
  const deleted_renders = [];

  const queue = [{ prev: prev_document.documentElement, curr: curr_document.documentElement, inherited: false }];
  while (queue.length) {
    const { prev, curr, inherited } = queue.shift();
    const slots = align_children([
      prev ? Array.from(prev.children) : null,
      curr ? Array.from(curr.children) : null,
    ]);
    // 删除渲染的插入锚点：其后第一个仍存在于当前页的同层元素，让幽灵节点回到原来的位置。
    const pending = [];
    const anchor = (element) => {
      for (const render of pending.splice(0)) deleted_renders.push({ ...render, before: element });
    };
    for (const [prev_element, curr_element] of slots) {
      if (prev_element && curr_element) {
        anchor(curr_element);
        annotate_changed_pair(prev_element, curr_element, baseline_label);
        queue.push({ prev: prev_element, curr: curr_element, inherited: false });
      } else if (curr_element) {
        anchor(curr_element);
        if (!inherited && is_content_element(curr_element)) {
          added.push(node_info(curr_element));
          const detail = detail_payload(curr_element, { kind: "added", baseline: baseline_label });
          curr_element.setAttribute("data-compare-added", "");
          curr_element.setAttribute("title", "新增内容：上一条记录不存在此元素");
          curr_element.setAttribute("data-compare-detail", detail);
        }
        queue.push({ prev: null, curr: curr_element, inherited: true });
      } else {
        if (!inherited && is_content_element(prev_element)) {
          removed.push(node_info(prev_element));
          // 仅当父节点在当前页存在时才能原位渲染（父节点已删则整个子树都记在父节点上）。
          if (curr) pending.push({ parent: curr, node: prev_element });
        }
        queue.push({ prev: prev_element, curr: null, inherited: true });
      }
    }
    anchor(null);
  }

  for (const { parent, node, before } of deleted_renders) {
    // 克隆被删节点本体渲染回原位置：元素类型与父节点不变，因此嵌套关系（li/ul、tr/tbody）仍然合法。
    const ghost = curr_document.importNode(node, true);
    ghost.setAttribute("data-compare-deleted", "");
    ghost.setAttribute("title", "删除内容：上一条记录存在此元素");
    // 明细取自基准页的原始节点：克隆发生在插入前，自身还没有完整路径。
    ghost.setAttribute("data-compare-detail", detail_payload(node, { kind: "deleted", baseline: baseline_label }));
    if (before) parent.insertBefore(ghost, before);
    else parent.append(ghost);
  }

  return { added, removed };
}

// 每对 (i-1, i) 独立解析两份干净副本：当前页写入标注、基准页只读后丢弃，
// 避免上一对的 <mark>/<del>/data-compare-* 混入本对的对齐与叶子文本判断。
export function build_pairwise_comparison(records) {
  const documents = records.map(() => null);
  const reports = records.map(() => null);
  if (records.length) documents[0] = parse_record(records[0]);
  for (let index = 1; index < records.length; index += 1) {
    const prev_document = parse_record(records[index - 1]);
    const curr_document = parse_record(records[index]);
    reports[index] = {
      baseline: index - 1,
      ...diff_pair(prev_document, curr_document, `${index}. ${records[index - 1].title}`),
    };
    documents[index] = curr_document;
  }
  return { documents, reports };
}

function finalize_document(document, record) {
  document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i],meta[http-equiv="refresh" i]').forEach((element) => element.remove());
  const base = document.createElement("base");
  base.href = record.url;
  document.head.prepend(base);
  const style = document.createElement("style");
  style.textContent = [
    // 标注不改节点自身外观：着色全部由 absolute 伪元素遮罩覆盖，边框用不占布局的 outline；
    // position:relative 仅作遮罩锚点且不带 !important，尽量让位于页面自身的定位声明。
    '[data-compare-added]{position:relative;outline:2px solid #22c55e!important;outline-offset:1px}',
    '[data-compare-added]::before{content:""!important;position:absolute!important;inset:0!important;background-color:rgba(34,197,94,.14)!important;pointer-events:none!important}',
    '[data-compare-added]:hover{outline-color:#16a34a!important}',
    '[data-compare-added]:hover::before{background-color:rgba(34,197,94,.26)!important}',
    '[data-compare-deleted]{position:relative;margin-top:18px!important;outline:1px dashed #dc2626!important;outline-offset:0px}',
    '[data-compare-deleted]::before{content:""!important;position:absolute!important;inset:0!important;background-color:rgba(220,38,38,.22)!important;pointer-events:none!important}',
    '[data-compare-deleted]::after{content:"删除"!important;position:absolute!important;bottom:100%!important;left:0!important;margin-bottom:2px!important;padding:0 4px!important;font-size:10px!important;font-weight:600!important;line-height:1.5!important;color:#fff!important;background-color:#dc2626!important;border-radius:2px!important;box-shadow:0 1px 2px rgba(0,0,0,.25)!important;text-decoration:none!important;white-space:nowrap!important;pointer-events:none!important}',
    '[data-compare-changed]{position:relative;outline:2px solid #f59e0b!important;outline-offset:1px}',
    '[data-compare-changed]::before{content:""!important;position:absolute!important;inset:0!important;background-color:rgba(245,158,11,.16)!important;pointer-events:none!important}',
    '[data-compare-changed]:hover{outline-color:#ef4444!important}',
    '[data-compare-changed]:hover::before{background-color:rgba(239,68,68,.22)!important}',
    '[data-compare-text-diff]{background-color:#fde047!important;outline:1px solid #f59e0b}',
    // 点击任意差异标注可在对比页弹出变更说明，用手型光标提示可点。
    '[data-compare-added],[data-compare-deleted],[data-compare-changed],[data-compare-text-diff]{cursor:pointer!important}',
  ].join("");
  document.head.append(style);
  return "<!doctype html>\n" + document.documentElement.outerHTML;
}

export function build_comparison_documents(records) {
  const { documents } = build_pairwise_comparison(records);
  return documents.map((document, index) => finalize_document(document, records[index]));
}

// 每条记录（第 2 条起）相对前一条的新增/移除清单；首条为基准，报告为 null。
export function build_comparison_reports(records) {
  return build_pairwise_comparison(records).reports;
}

// 单条记录的预览：与对比页相同的解析与安全处理（去 script/CSP/refresh、注入 base），但不注入差异高亮。
export function build_preview_document(record) {
  const document = parse_record(record);
  document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i],meta[http-equiv="refresh" i]').forEach((element) => element.remove());
  const base = document.createElement("base");
  base.href = record.url;
  document.head.prepend(base);
  return "<!doctype html>\n" + document.documentElement.outerHTML;
}

export function ComparisonModel(client = chrome) {
  let records = [];
  let group_name = default_comparison_group;
  return {
    get records() { return records; },
    get group_name() { return group_name; },
    async ready() {
      const saved = await client.storage.local.get([comparison_records_key, comparison_group_key]);
      records = Array.isArray(saved[comparison_records_key]) ? saved[comparison_records_key] : [];
      if (typeof saved[comparison_group_key] === "string" && saved[comparison_group_key].trim()) group_name = saved[comparison_group_key].trim();
      return records;
    },
    // 对比页只渲染当前选中分组（弹窗中选择的分组），记录不足两条时返回 null。
    selected_group() {
      const group = group_comparison_records(records).find((group) => group.name === group_name);
      if (!group || group.records.length < 2) return null;
      const { documents, reports } = build_pairwise_comparison(group.records);
      return {
        ...group,
        documents: documents.map((document, index) => finalize_document(document, group.records[index])),
        reports,
      };
    },
  };
}
