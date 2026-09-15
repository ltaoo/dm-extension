import "../../assets/vendor/timeless.dom.umd.min.js";
import "../../assets/vendor/timeless.web.umd.min.js";
import { Button, Dialog, DialogBody, DialogDescription } from "../../assets/vendor/src/dmui.js";
import { ComparisonModel, describe_node } from "./compare.model.js";

const { View, Webview, Show, For, combine, computed, ref, DOM, ui, web, vm } = window.Timeless;
ui.InputPrimitive.setInputProvider(web);
ui.ScrollViewPrimitive.setScrollViewProvider(web);

const model = ComparisonModel();

// —— 页面状态：loading → ready / empty / error。 ——
const page_ = ref({ status: "loading" });

// —— 变更说明弹窗：点击差异遮罩后展示明细，内容经 computed 响应式渲染。 ——
const detail_ = ref(null);
const detail_dialog$ = new vm.DialogCore({ title: "变更说明", footer: false });
const kind_labels = { added: "新增内容", deleted: "删除内容", changed: "内容变更", text: "文本差异" };

function show_detail(payload) {
  detail_.as(payload);
  detail_dialog$.setTitle(`${kind_labels[payload.kind] || "变更"}说明`);
  detail_dialog$.show();
}

const detail_kind_ = computed(detail_, (payload) => (payload && kind_labels[payload.kind]) || "");
const detail_baseline_ = computed(detail_, (payload) => (payload && payload.baseline) || "");
const detail_node_ = computed(detail_, (payload) => (payload && describe_node(payload.info)) || "");
const detail_text_ = computed(detail_, (payload) => (payload && payload.info && payload.info.text) || "");
const detail_path_ = computed(detail_, (payload) => (payload && payload.info && payload.info.path) || "");
const detail_from_ = computed(detail_, (payload) => (payload && payload.from) || "");
const detail_to_ = computed(detail_, (payload) => (payload && payload.to) || "");
const detail_attributes_ = computed(detail_, (payload) => (payload && payload.attributes) || []);
const detail_text_change_ = computed(detail_, (payload) => (payload && payload.text) || null);
const detail_children_change_ = computed(detail_, (payload) => (payload && payload.children) || null);

const frames = new Set();

// 内容按面板宽度 100% 渲染，iframe 高度随内容自适应，纵向滚动交给外层容器。
function fit_frame(frame) {
  const doc = frame.contentDocument;
  if (!doc) return;
  const height = Math.max(doc.documentElement.scrollHeight, (doc.body && doc.body.scrollHeight) || 0);
  if (height) frame.style.height = `${height}px`;
}

window.addEventListener("resize", () => {
  for (const frame of frames) fit_frame(frame);
});

// iframe 高度随内容自适应、自身不滚动，把 iframe 内元素换算到外层滚动容器坐标后平滑滚动居中。
function scroll_element_into_view(element, frame) {
  const root = document.querySelector('[data-n="comparison-root"]');
  const root_box = root.getBoundingClientRect();
  const frame_box = frame.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  const center_in_root = frame_box.top - root_box.top + root.scrollTop + box.top + box.height / 2;
  root.scrollTo({ top: Math.max(0, center_in_root - root.clientHeight / 2), behavior: "smooth" });
}

// 点击 iframe 内的差异遮罩：明细以 JSON 存于元素属性，解析后弹出变更说明。
// 沙箱未放行脚本，页面本就不可交互；阻止默认行为避免点击标注中的链接/锚点跳转 iframe。
function handle_frame_click(event) {
  const target = event.target;
  if (!target || typeof target.closest !== "function") return;
  const marked = target.closest("[data-compare-added],[data-compare-deleted],[data-compare-changed],[data-compare-text-diff]");
  if (!marked) return;
  event.preventDefault();
  const raw = marked.getAttribute("data-compare-detail");
  if (!raw) return;
  try {
    show_detail(JSON.parse(raw));
  } catch {
    // 明细损坏时保持静默，仍有原生 title 悬停提示兜底。
  }
}

// —— 变更说明弹窗视图 ——

function detail_row(name, label, value) {
  return View({ class: "comparison-detail-row", attributes: { n: `comparison-detail-${name}` } }, [
    View({ class: "comparison-detail-label", attributes: { n: `comparison-detail-${name}-label` } }, [label]),
    View({ class: "comparison-detail-value", attributes: { n: `comparison-detail-${name}-value` } }, [value]),
  ]);
}

function attribute_change_text(change) {
  if (change.added) return `${change.name}="${change.to}"（新增属性）`;
  if (change.removed) return `${change.name}="${change.from}"（移除属性）`;
  return `${change.name}："${change.from}" → "${change.to}"`;
}

function DetailAttributesView() {
  return View({ class: "comparison-detail-attrs", attributes: { n: "comparison-detail-attrs", role: "list" } }, [
    For({
      each: detail_attributes_,
      key: "name",
      render(change) {
        return View({ class: "comparison-detail-attr", attributes: { n: "comparison-detail-attr", role: "listitem" } }, [attribute_change_text(change)]);
      },
    }),
  ]);
}

function ChangeDetailDialogView() {
  return Dialog({
    store: detail_dialog$,
    class: "dm-dialog--md comparison-detail-dialog",
    attributes: { n: "comparison-detail-dialog" },
  }, [
    DialogBody({ class: "dm-dialog-body--scrollable comparison-detail-body", attributes: { n: "comparison-detail-body" } }, [
      DialogDescription({ attributes: { n: "comparison-detail-baseline" } }, [computed(detail_baseline_, (baseline) => `基准记录：${baseline}`)]),
      detail_row("kind", "类型", detail_kind_),
      detail_row("node", "节点", detail_node_),
      Show({ when: computed(detail_text_, (text) => Boolean(text)), ok: () => detail_row("text", "内容片段", detail_text_) }),
      detail_row("path", "路径", detail_path_),
      Show({ when: computed(detail_, (payload) => payload && payload.kind === "text"), ok: () => [
        detail_row("from", "原文本", detail_from_),
        detail_row("to", "新文本", detail_to_),
      ] }),
      Show({ when: computed(detail_, (payload) => payload && payload.kind === "changed"), ok: () => [
        Show({ when: computed(detail_attributes_, (changes) => changes.length > 0), ok: () => detail_row("attributes", "属性变化", DetailAttributesView()) }),
        Show({ when: computed(detail_text_change_, (change) => Boolean(change)), ok: () => detail_row("text-change", "文本变化", computed(detail_text_change_, (change) => `${change.from || "（空）"} → ${change.to || "（空）"}`)) }),
        Show({ when: computed(detail_children_change_, (change) => Boolean(change)), ok: () => detail_row("children", "子元素数量", computed(detail_children_change_, (change) => `${change.from} → ${change.to}`)) }),
      ] }),
    ]),
  ]);
}

// —— 对比面板视图 ——

// 面板简报：首条为基准；其余汇总相对前一条的新增/移除节点清单（悬停显示路径）。
// 简报行附 ↑/↓ 导航，在本面板全部变更（新增/移除/变更/文本差异）间循环跳转并滚动到视口。
function ReportView(report, panel_frame) {
  if (!report) {
    return View({ class: "comparison-panel-report is-baseline", attributes: { n: "comparison-panel-report" } }, ["基准记录（无前一条）"]);
  }
  const position_ = ref(-1);
  const total_ = ref(0);
  const counter_ = combine({ position: position_, total: total_ }, (s) => (s.position < 0 ? "" : `${s.position + 1}/${s.total}`));

  const jump = (delta) => {
    const frame = panel_frame.element;
    const doc = frame && frame.contentDocument;
    if (!doc) return;
    const changes = Array.from(doc.querySelectorAll("[data-compare-added],[data-compare-deleted],[data-compare-changed],[data-compare-text-diff]"));
    if (!changes.length) return;
    const next = (position_.value + delta + changes.length) % changes.length;
    position_.as(next);
    total_.as(changes.length);
    scroll_element_into_view(changes[next], frame);
  };

  const nav_button = (label, title, delta) => {
    const button$ = new vm.ButtonCore({ variant: "ghost", size: "xs" });
    button$.onClick(() => jump(delta));
    return Button({
      store: button$,
      class: "comparison-report-nav-button",
      attributes: { n: delta < 0 ? "comparison-report-prev" : "comparison-report-next", title, "aria-label": title },
    }, [label]);
  };

  const entries = [
    ...report.added.map((info) => ({ info, added: true })),
    ...report.removed.map((info) => ({ info, added: false })),
  ];
  return View({ class: "comparison-panel-report", attributes: { n: "comparison-panel-report" } }, [
    View({ class: "comparison-panel-report-summary", attributes: { n: "comparison-panel-report-summary" } }, [
      `较第 ${report.baseline + 1} 条：新增 ${report.added.length} · 移除 ${report.removed.length}`,
      View({ class: "comparison-report-nav", attributes: { n: "comparison-report-nav" } }, [
        nav_button("↑", "上一个变更", -1),
        View({ class: "comparison-report-counter", attributes: { n: "comparison-report-counter" } }, [counter_]),
        nav_button("↓", "下一个变更", 1),
      ]),
    ]),
    View({ class: "comparison-panel-report-list", attributes: { n: "comparison-panel-report-list", role: "list" } },
      entries.map(({ info, added }) => View({
        class: `comparison-panel-report-item is-${added ? "added" : "removed"}`,
        attributes: { n: "comparison-panel-report-item", role: "listitem", title: info.path },
      }, [`${added ? "+" : "−"} ${describe_node(info)}${info.text ? `（${info.text}）` : ""}`]))),
  ]);
}

// Webview 渲染 iframe：挂载后绑定 load（高度自适应 + 遮罩点击）并登记到全局 frames 供 resize 重算。
function PageFrameView(document_html, record, panel_frame) {
  return Webview({
    class: "comparison-page-frame",
    attributes: {
      n: "comparison-page-frame",
      title: `暂存页面：${record.title}`,
      sandbox: "allow-same-origin",
      srcdoc: document_html,
    },
    onMounted(event) {
      const frame = event && event.target;
      if (!frame) return;
      panel_frame.element = frame;
      frames.add(frame);
      frame.addEventListener("load", () => {
        fit_frame(frame);
        if (frame.contentDocument) frame.contentDocument.addEventListener("click", handle_frame_click);
      });
    },
    onUnmounted() {
      frames.delete(panel_frame.element);
      panel_frame.element = null;
    },
  });
}

function PanelView(group, record, index) {
  const panel_frame = { element: null };
  return View({ class: "comparison-panel", attributes: { n: "comparison-panel" } }, [
    View({ class: "comparison-panel-heading", attributes: { n: "comparison-panel-heading", title: record.url } }, [`${index + 1}. ${record.title}`]),
    ReportView((group.reports || [])[index], panel_frame),
    PageFrameView(group.documents[index], record, panel_frame),
  ]);
}

function GroupView(group) {
  return View({ class: "comparison-group", attributes: { n: "comparison-group" } }, [
    View({ class: "comparison-group-heading", attributes: { n: "comparison-group-heading" } }, [`${group.name}（${group.records.length} 条）`]),
    View({ class: "comparison-group-panels", attributes: { n: "comparison-group-panels" } },
      group.records.map((record, index) => PanelView(group, record, index))),
  ]);
}

function ComparisonAppView() {
  return View({ class: "comparison-root", attributes: { n: "comparison-root", role: "main", "aria-label": "暂存页面对比" } }, [
    Show({ when: computed(page_, (page) => page.status === "ready"), ok: () => GroupView(page_.value.group) }),
    Show({ when: computed(page_, (page) => page.status === "empty"), ok: () => View({ class: "comparison-status", attributes: { n: "comparison-empty" } }, [`当前分组「${page_.value.group_name}」暂存记录不足两条，请先在扩展弹窗中暂存。`]) }),
    Show({ when: computed(page_, (page) => page.status === "error"), ok: () => View({ class: "comparison-status", attributes: { n: "comparison-error" } }, [`加载对比失败：${page_.value.message}`]) }),
    Show({ when: computed(page_, (page) => page.status === "loading"), ok: () => View({ class: "comparison-status", attributes: { n: "comparison-loading" } }, ["加载中…"]) }),
    ChangeDetailDialogView(),
  ]);
}

DOM.render(ComparisonAppView(), document.querySelector("#root"));

model.ready().then(() => {
  const group = model.selected_group();
  page_.as(group ? { status: "ready", group } : { status: "empty", group_name: model.group_name });
}).catch((error) => {
  page_.as({ status: "error", message: error.message });
});
