import { Button, Card, Input, Label } from "../../assets/vendor/src/dmui.js";

const { View, For, computed, combine } = window.Timeless;

export default function ScheduledSitesPageView({ store }) {
  const { state: page_state, scheduled_sites: { state, ui } } = store;
  const field = (id, controls, name, title, attributes = {}) => View({ class: "settings-field", attributes: { n: `scheduled-${name}-field` } }, [
    Label({ attributes: { n: `scheduled-${name}-label`, id: `scheduled-${id}-${name}-label` } }, [title]),
    Input({ store: controls[name], rootAttributes: { n: `scheduled-${name}-wrapper` }, attributes: { n: `scheduled-${name}-input`, "aria-labelledby": `scheduled-${id}-${name}-label`, ...attributes } }),
  ]);
  return View({
    class: computed(page_state.page, (page) => `scheduled-sites-page popup-page ${page === "scheduled-sites" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "scheduled-sites-page", id: "scheduled-sites-page", role: "region", "aria-label": "定时访问",
      hidden: combine({ page: page_state.page, leaving: page_state.leaving_page }, (s) => s.page !== "scheduled-sites" && s.leaving !== "scheduled-sites" ? true : undefined),
      inert: computed(page_state.page, (page) => page !== "scheduled-sites" ? true : undefined),
      "aria-hidden": computed(page_state.page, (page) => page !== "scheduled-sites" ? "true" : undefined),
    },
  }, [View({ class: "settings-scroll", attributes: { n: "scheduled-sites-scroll" } }, [
    View({ class: "page-help", attributes: { n: "scheduled-sites-empty", hidden: computed(state.sites, (sites) => sites.length ? true : undefined) } }, ["暂无任务，点击右上角「新增」创建。"]),
    For({ each: state.sites, key: "id", render(site) {
      const controls = ui.record(site.id);
      return Card({ class: "settings-card", attributes: { n: "scheduled-site-item", "data-site-id": site.id } }, [
        field(site.id, controls, "url", "网站地址", { spellcheck: "false", autocomplete: "off" }),
        View({ class: "settings-row scheduled-site-options", attributes: { n: "scheduled-site-options" } }, [
          field(site.id, controls, "interval_minutes", "间隔（分钟）", { min: "0.5", max: "10080", step: "0.5" }),
          field(site.id, controls, "duration_seconds", "停留（秒）", { min: "1", max: "86400", step: "1" }),
          Button({ store: controls.save, attributes: { n: "scheduled-site-save" } }, ["保存"]),
        ]),
        View({ class: "scheduled-site-footer", attributes: { n: "scheduled-site-footer" } }, [
          View({ class: "page-help", attributes: { n: "scheduled-site-summary", role: "status" } }, [controls.status]),
          View({ class: "scheduled-site-actions", attributes: { n: "scheduled-site-actions" } }, [
            Button({ store: controls.toggle, attributes: { n: "scheduled-site-toggle", "aria-label": computed(controls.enabled, (enabled) => enabled ? "暂停任务" : "启用任务") } }, [computed(controls.enabled, (enabled) => enabled ? "暂停" : "启用")]),
            Button({ store: controls.visit, attributes: { n: "scheduled-site-visit", "aria-label": "立即访问任务网站" } }, ["立即访问"]),
            Button({ store: controls.remove, attributes: { n: "scheduled-site-remove", "aria-label": "删除任务" } }, ["删除"]),
          ]),
        ]),
      ]);
    } }),
  ])]);
}
