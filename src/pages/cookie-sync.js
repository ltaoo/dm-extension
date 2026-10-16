import { ArrayField, Button, Card, Checkbox, IconButton, Input, Label, Popover, Select, Tabs } from "../../assets/vendor/src/dmui.js";

const { View, Icon, computed, combine, classNames } = window.Timeless;

function Field(name, title, control) {
  return View({ class: "settings-field", attributes: { n: `${name}-field` } }, [
    Label({ attributes: { n: `${name}-label`, id: `${name}-label` } }, [title]),
    control,
  ]);
}

export default function CookieSyncPageView({ store }) {
  const { state, ui } = store;
  const input = (name, field, attributes = {}) => Input({
    store: ui.inputs[field],
    rootAttributes: { n: `${name}-wrapper` },
    attributes: { n: `${name}-input`, "aria-labelledby": `${name}-label`, ...attributes },
  });
  return View({
    class: computed(state.page, (page) => `cookie-sync-page settings-panel popup-page ${page === "cookie-sync" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "cookie-sync-page", id: "cookie-sync-page", "aria-label": "Cookie 同步设置",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "cookie-sync" && s.leaving !== "cookie-sync" ? true : undefined),
      inert: computed(state.page, (page) => page !== "cookie-sync" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "cookie-sync" ? "true" : undefined),
    },
  }, [
    View({ class: "profile-toolbar", attributes: { n: "profile-toolbar", inert: computed(state.busy, (busy) => busy ? true : undefined) } }, [
      Tabs({
        class: "profile-tabs", attributes: { n: "profile-tabs", "aria-label": "同步接口配置" },
        each: state.profiles, key: "id",
        render(profile) {
          const active = computed(state.active_profile, (id) => id === profile.id);
          const buttons = ui.profile_button(profile.id);
          const open_menu = (event) => {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            const anchor = DOMRect.fromRect(event.type === "contextmenu" && (event.clientX || event.clientY)
              ? { x: event.clientX, y: event.clientY, width: 0, height: 0 }
              : { x: rect.left, y: rect.bottom, width: 0, height: 0 });
            buttons.menu.popper.setReference({ $el: event.currentTarget, getRect: () => anchor }, { force: true });
            store.methods.open_profile_menu(profile.id);
            requestAnimationFrame(() => document.querySelector(`[n="profile-context-menu"][data-profile-id="${profile.id}"] button`)?.focus());
          };
          return View({
            class: classNames(["profile-tab-wrap", computed(active, (selected) => selected ? "is-active" : "")]),
            attributes: { n: "profile-tab-wrap", "data-profile-id": profile.id },
            onContextMenu: open_menu,
            onKeyDown(event) {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) open_menu(event);
            },
          }, [
            Popover({
              store: buttons.menu, class: "profile-context-menu",
              attributes: { n: "profile-context-menu", "data-profile-id": profile.id, role: "menu", "aria-label": "配置操作" },
              onKeyDown(event) {
                if (event.key === "Escape") {
                  buttons.menu.hide();
                  document.querySelector(`[n="profile-tab"][data-profile-id="${profile.id}"]`)?.focus();
                } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                  const items = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
                  const index = items.indexOf(document.activeElement);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
                  items[next]?.focus();
                } else if (event.key === "Tab") {
                  buttons.menu.hide();
                  return;
                } else return;
                event.preventDefault();
                event.stopPropagation();
              },
              content: [
                Button({ store: buttons.copy_item, attributes: { n: "copy-profile-menu-item", role: "menuitem" } }, ["复制"]),
                Button({ store: buttons.remove_item, attributes: { n: "remove-profile-menu-item", role: "menuitem" } }, ["删除"]),
              ],
            }),
            Button({
              store: buttons.tab, class: "profile-tab",
              attributes: { n: "profile-tab", "data-profile-id": profile.id, role: "tab", "aria-selected": computed(active, String), tabindex: computed(active, (selected) => selected ? "0" : "-1") },
            }, [computed(state.profile_titles, (titles) => titles[profile.id])]),
            IconButton({
              store: buttons.remove, class: "profile-remove",
              attributes: { n: "remove-profile-button", "data-profile-id": profile.id, title: "删除此配置，至少保留一个已保存配置", "aria-label": computed(state.profile_titles, (titles) => `删除配置「${titles[profile.id]}」`) },
            }, [Icon({ name: "x", size: 12, attributes: { n: "remove-profile-icon", "aria-hidden": "true" } })]),
          ]);
        },
      }),
    ]),
    View({ class: "settings-scroll", attributes: { n: "settings-scroll" } }, [
      View({ attributes: { n: "sync-fields", inert: computed(state.busy, (busy) => busy ? true : undefined) } }, [
        Card({ class: "settings-card", attributes: { n: "sync-panel" } }, [
          Field("profile-name", "配置名称", input("profile-name", "name")),
          Field("endpoint", "同步接口", input("endpoint", "endpoint", { spellcheck: "false" })),
          View({ class: "settings-row schedule-row", attributes: { n: "schedule-row" } }, [
            Checkbox({ store: ui.enabled$, text: "定时同步", attributes: { n: "enabled-input", "aria-label": "定时同步" }, textAttributes: { n: "enabled-label" } }),
            Field("interval", "间隔（分钟）", input("interval", "intervalMinutes", { min: "0.5", max: "1440", step: "0.5" })),
          ]),
        ]),
        Card({ class: "settings-card", attributes: { n: "domain-panel" } }, [
          View({ class: "domain-list-heading", attributes: { n: "domain-list-heading" } }, [
            Label({ attributes: { n: "domains-label", id: "domains-label" } }, [computed(state.domain_count, (count) => `域名列表（${count}）`)]),
            Button({ store: ui.add_domain$, attributes: { n: "add-domain-button" } }, ["添加域名"]),
          ]),
          ArrayField({
            store: ui.domains$, class: "domain-list", attributes: { n: "domains-array-field", "aria-labelledby": "domains-label" },
            render({ idx, field }) {
              return View({ class: "domain-row", attributes: { n: "domain-row" } }, [
                Checkbox({ store: field.fields.enabled.input, attributes: { n: "domain-enabled-input", "aria-label": `启用第 ${idx + 1} 条域名规则` } }),
                Input({ store: field.fields.domain.input, rootAttributes: { n: "domain-input-wrapper" }, attributes: { n: "domain-input", "aria-label": `第 ${idx + 1} 条域名`, spellcheck: "false" } }),
                Button({ store: field.remove$, attributes: { n: "remove-domain-button", "aria-label": `删除第 ${idx + 1} 条域名规则` } }, ["删除"]),
              ]);
            },
          }),
          View({ class: "page-help", attributes: { n: "domain-list-help" } }, ["仅同步勾选的域名，空白行不参与同步。支持子域和完整 URL。"]),
        ]),
        Card({ class: "settings-card", attributes: { n: "encryption-panel" } }, [
          Field("encryption", "加密方式", Select({ store: ui.encryption$, attributes: { n: "encryption-input", "aria-labelledby": "encryption-label" } })),
          View({ class: "settings-row", attributes: { n: "encryption-credentials", hidden: computed(state.encrypted, (encrypted) => encrypted ? undefined : true) } }, [
            Field("uuid", "UUID", input("uuid", "encryption.uuid", { autocomplete: "off", spellcheck: "false" })),
            Field("password", "密码", input("password", "encryption.password", { autocomplete: "off" })),
          ]),
        ]),
      ]),
    ]),
    View({ class: "settings-footer", attributes: { n: "settings-footer" } }, [
      View({ class: "settings-feedback", attributes: { n: "settings-feedback" } }, [
        View({ class: classNames(["sync-status", computed(state.status, (status) => status.error ? "error" : "")]), attributes: { n: "sync-status", role: "status", title: state.sync_message } }, [state.sync_message]),
      ]),
      View({ class: "settings-actions", attributes: { n: "sync-actions" } }, [
        Button({ store: ui.save$, attributes: { n: "save-button" } }, ["保存当前"]),
        Button({ store: ui.sync$, attributes: { n: "sync-button" } }, ["保存并同步当前"]),
      ]),
    ]),
  ]);
}
