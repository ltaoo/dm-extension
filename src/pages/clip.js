import { Button, Checkbox } from "../../assets/vendor/src/dmui.js";

const { View, computed, combine, classNames, For } = window.Timeless;

function format_size(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

function stats_of(record) {
  const parts = [`${record.element_count} 个元素`];
  if (record.width && record.height) parts.push(`${record.width}×${record.height}`);
  if (record.image_count) parts.push(record.image_missing ? `图片 ${record.image_count}（缺失 ${record.image_missing}）` : `图片 ${record.image_count}`);
  const size = format_size(record.byte_size);
  if (size) parts.push(size);
  return parts.join(" · ");
}

export default function ClipPageView({ store }) {
  const { state, ui } = store;
  return View({
    class: computed(state.page, (page) => `clip-page popup-page ${page === "clip" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "clip-page", id: "clip-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "clip" && s.leaving !== "clip" ? true : undefined),
      inert: computed(state.page, (page) => page !== "clip" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "clip" ? "true" : undefined),
    },
  }, [
    View({ class: "clip-toolbar", attributes: { n: "clip-toolbar" } }, [
      View({ class: "section-title", attributes: { n: "clip-heading", role: "heading", "aria-level": "2" } }, ["区域剪藏"]),
      View({ class: "muted clip-count", attributes: { n: "clip-count" } }, [computed(state.clip_count, (count) => `共 ${count} 条`)]),
    ]),
    View({ class: "clip-actions", attributes: { n: "clip-actions" } }, [
      Button({
        store: ui.start_clip$,
        attributes: { n: "start-clip-button", "aria-label": "在页面上框选区域剪藏" },
      }, [computed(state.clip_loading, (loading) => loading ? "启动中…" : "框选剪藏")]),
      Button({ store: ui.clear_clips$, attributes: { n: "clear-clips-button" } }, ["清空"]),
      View({ class: "muted clip-target", attributes: { n: "clip-target", title: state.url } }, [computed(state.url, (url) => url || "未获取到当前页面")]),
    ]),
    View({ class: "clip-options", attributes: { n: "clip-options" } }, [
      Checkbox({ store: ui.clip_important$, text: "样式加 !important", attributes: { n: "clip-important-input", "aria-label": "样式加 !important" }, textAttributes: { n: "clip-important-label" } }),
      Checkbox({ store: ui.clip_inline_images$, text: "图片内联为 data URL", attributes: { n: "clip-inline-images-input", "aria-label": "图片内联为 data URL" }, textAttributes: { n: "clip-inline-images-label" } }),
      Checkbox({ store: ui.clip_pseudo$, text: "还原 ::before / ::after", attributes: { n: "clip-pseudo-input", "aria-label": "还原伪元素" }, textAttributes: { n: "clip-pseudo-label" } }),
    ]),
    View({
      class: "clip-feedback",
      attributes: { n: "clip-feedback", role: "status", hidden: computed(state.clip_feedback, (message) => !message ? true : undefined) },
    }, [state.clip_feedback]),
    View({ class: "clip-records", attributes: { n: "clip-records", role: "list", "aria-label": "剪藏记录" } }, [
      For({
        each: state.clip_records,
        key: "id",
        render(record) {
          const buttons = ui.clip_button(record.id);
          // 行的 DOM 按 key 复用：只有「已复制」会随状态变化，包成 computed 才会就地更新；
          // 其余字段（标题、统计）对同一条记录恒定，直接读捕获值。
          const copied = computed(state.clip_copied, (id) => id === record.id);
          return View({ class: "clip-record-row", attributes: { n: "clip-record-row", role: "listitem" } }, [
            View({ class: "clip-record-main", attributes: { n: "clip-record-main" } }, [
              Button({
                store: buttons.open,
                class: "clip-record-open",
                attributes: { n: "clip-record-open", title: `预览 ${record.title}${record.url ? `（${record.url}）` : ""}` },
              }, [record.title]),
              View({ class: "muted clip-record-stats", attributes: { n: "clip-record-stats" } }, [stats_of(record)]),
              View({ class: "muted clip-record-source", attributes: { n: "clip-record-source", title: record.url } }, [`来源 ${record.hostname || "未知"}`]),
            ]),
            View({ class: "clip-record-actions", attributes: { n: "clip-record-actions" } }, [
              Button({
                store: buttons.copy,
                class: classNames(["clip-record-copy", computed(copied, (value) => value ? "is-copied" : "")]),
                attributes: { n: "clip-record-copy", "aria-label": `复制 ${record.title} 的片段` },
              }, [computed(copied, (value) => value ? "已复制" : "复制")]),
              Button({ store: buttons.remove, attributes: { n: "clip-record-remove", "aria-label": `删除 ${record.title}` } }, ["删除"]),
            ]),
          ]);
        },
      }),
      View({
        class: "muted clip-records-empty",
        attributes: { n: "clip-records-empty", hidden: computed(state.clip_count, (count) => count ? true : undefined) },
      }, ["暂无剪藏记录"]),
    ]),
    View({ class: "page-help", attributes: { n: "clip-help" } }, [
      "剪藏 = 在网页上框选一块内容，连同它当前的样式一起冻结成一段自包含 HTML：不含 script、不引用任何外部资源（图片会转成 data URL，取不到的原尺寸占位），粘到任何页面里都按原样显示。点「框选剪藏」后弹窗关闭、页面进入挑选状态：拖动框选区域（单击选节点），↑ / ↓ 在父 / 子容器间切换，回车剪藏，Esc 取消；点「剪藏」后在页面上等一会儿，结果页会自动打开，可预览、复制片段或复制完整文档。样式按「每个元素只写与父级不同的部分」内联，因此不受目标页面自带 CSS 影响；取不到的图片用同尺寸占位符标出。同名节点的祖先链（表格单元格、列表项等）会一并补上，避免粘进表格 / 列表后错位。",
    ]),
  ]);
}
