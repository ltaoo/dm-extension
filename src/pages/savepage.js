import { Button, Tabs } from "../../assets/vendor/src/dmui.js";

const { View, computed, combine, classNames, For } = window.Timeless;

export default function SavePageView({ store }) {
  const { state, ui } = store;
  return View({
    class: computed(state.page, (page) => `savepage-page popup-page ${page === "savepage" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "savepage-page", id: "savepage-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "savepage" && s.leaving !== "savepage" ? true : undefined),
      inert: computed(state.page, (page) => page !== "savepage" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "savepage" ? "true" : undefined),
    },
  }, [
    View({ class: "savepage-toolbar", attributes: { n: "savepage-toolbar" } }, [
      View({ class: "savepage-site", attributes: { n: "savepage-site" } }, [
        View({ class: "section-title", attributes: { n: "comparison-heading", role: "heading", "aria-level": "2" } }, ["当前页面"]),
        View({ class: "savepage-url", attributes: { n: "savepage-url", title: state.url } }, [computed(state.url, (url) => url || "未获取到当前页面")]),
      ]),
      Button({
        store: ui.refresh_page$,
        attributes: { n: "savepage-refresh-button" },
      }, [computed(state.savepage_loading, (loading) => loading ? "读取中…" : "重新获取")]),
    ]),
    View({ class: "savepage-groups", attributes: { n: "savepage-groups" } }, [
      View({ class: "section-title", attributes: { n: "comparison-group-label" } }, ["分组"]),
      Tabs({
        class: "comparison-groups",
        attributes: { n: "comparison-groups", "aria-label": "对比分组" },
        each: state.comparison_groups,
        key: "name",
        render(group) {
          const active = computed(state.comparison_group, (name) => name === group.name);
          const is_active = computed(active, (selected) => selected ? "is-active" : "");
          const buttons = ui.group_button(group.name);
          return View({ class: classNames(["comparison-group-tab-wrap", is_active]), attributes: { n: "comparison-group-tab-wrap" } }, [
            Button({
              store: buttons.tab,
              class: classNames(["comparison-group-tab", is_active]),
              attributes: { n: "comparison-group-tab", role: "tab", "aria-selected": computed(active, String), tabindex: computed(active, (selected) => selected ? "0" : "-1") },
            }, [group.name]),
            Button({
              store: buttons.remove,
              class: "comparison-group-remove",
              attributes: { n: "comparison-group-remove", title: `删除分组「${group.name}」`, "aria-label": `删除分组「${group.name}」` },
            }, ["×"]),
          ]);
        },
      }),
      Button({ store: ui.add_group$, attributes: { n: "add-group-button" } }, ["新增分组"]),
    ]),
    View({ class: "savepage-actions", attributes: { n: "savepage-actions" } }, [
      Button({
        store: ui.stage_page$,
        attributes: { n: "stage-page-button", "aria-label": "暂存当前页面" },
      }, ["暂存"]),
      Button({
        store: ui.copy_page$,
        class: classNames(["page-copy", computed(state.savepage_copied, (copied) => copied ? "is-copied" : "")]),
        attributes: { n: "copy-page-button", "aria-label": "复制当前页面 HTML" },
      }, [computed(state.savepage_copied, (copied) => copied ? "已复制" : "复制")]),
      View({ class: "muted comparison-count", attributes: { n: "comparison-count" } }, [computed(state.comparison_count, (count) => `已暂存 ${count} 条`)]),
      Button({ store: ui.clear_comparisons$, attributes: { n: "clear-comparisons-button" } }, ["清空"]),
      Button({ store: ui.start_comparison$, attributes: { n: "start-comparison-button" } }, ["开始对比"]),
    ]),
    View({ class: "savepage-feedback", attributes: { n: "savepage-feedback", role: "status", hidden: computed(state.savepage_feedback, (message) => !message ? true : undefined) } }, [state.savepage_feedback]),
    View({ class: "comparison-records", attributes: { n: "comparison-records", role: "list", "aria-label": "当前分组暂存页面" } }, [
      For({
        each: state.comparison_current_records,
        key: "id",
        render(record) {
          const buttons = ui.record_button(record.id);
          return View({ class: "comparison-record-row", attributes: { n: "comparison-record-row", role: "listitem" } }, [
            Button({
              store: buttons.open,
              class: "comparison-record-open",
              attributes: { n: "comparison-record-open", title: `预览 ${record.title}${record.url ? `（${record.url}）` : ""}` },
            }, [`${record.index + 1}. ${record.title}`]),
            Button({
              store: buttons.remove,
              class: "comparison-record-remove",
              attributes: { n: "comparison-record-remove", "aria-label": `删除 ${record.title}` },
            }, ["删除"]),
          ]);
        },
      }),
      View({ class: "muted comparison-records-empty", attributes: { n: "comparison-records-empty", hidden: computed(state.comparison_count, (count) => count ? true : undefined) } }, ["当前分组暂无暂存记录"]),
    ]),
    View({ class: "page-help", attributes: { n: "comparison-help" } }, [
      "暂存会保存移除 script 标签后的当前页面到当前分组（canvas 会转成 base64 图片，避免暂存后画布区域空白）。分组固定存在：组内记录清空后分组仍然保留，点分组标签上的「×」才会删除该分组及其全部记录（保留至少一个分组）。列表仅显示当前分组：点击记录在新标签页预览渲染效果，「删除」移除单条记录，「清空」仅清空当前分组。对比需当前分组至少两条记录；每条记录与其前一条对比：新增绿框、移除节点原位红色遮罩并标「删除」、变更描边，面板下方附节点清单简报。",
    ]),
  ]);
}
