import { ComparisonModel, build_preview_document } from "./compare.model.js";

// 预览页：按 URL 中的 id 从暂存记录里取单条，完整渲染 HTML 效果（iframe 内滚动）。
const model = ComparisonModel();
const id = new URLSearchParams(location.search).get("id");

function render_record(record) {
  const root = document.querySelector('[data-n="preview-root"]');
  document.title = `${record.title} - 页面预览`;
  root.textContent = "";

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

  const frame = document.createElement("iframe");
  frame.className = "preview-frame";
  frame.dataset.n = "preview-frame";
  frame.title = `暂存页面：${record.title}`;
  frame.sandbox = "allow-same-origin";
  frame.srcdoc = build_preview_document(record);

  heading.append(title, url);
  root.append(heading, frame);
}

model.ready().then(() => {
  const root = document.querySelector('[data-n="preview-root"]');
  const record = model.records.find((item) => item.id === id);
  if (!record) {
    root.textContent = id ? "未找到对应的暂存记录，可能已被删除。" : "缺少记录 id，请从扩展弹窗的暂存列表打开预览。";
    return;
  }
  render_record(record);
}).catch((error) => {
  document.querySelector('[data-n="preview-root"]').textContent = `加载预览失败：${error.message}`;
});
