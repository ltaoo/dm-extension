import { ArrayField, Button, Card, Checkbox, Input, Label, Select, Tabs } from "../../assets/vendor/src/dmui.js";

const { View, computed, combine, classNames } = window.Timeless;

function Field(name, title, control) {
  return View({ class: "settings-field", attributes: { n: `${name}-field` } }, [
    Label({ attributes: { n: `${name}-label`, id: `${name}-label` } }, [title]),
    control,
  ]);
}

export default function SettingsPageView({ store }) {
  const { state, ui } = store;
  const input = (name, field, attributes = {}) => Input({
    store: ui.inputs[field],
    rootAttributes: { n: `${name}-wrapper` },
    attributes: { n: `${name}-input`, "aria-labelledby": `${name}-label`, ...attributes },
  });
  return View({
    class: computed(state.page, (page) => `settings-page popup-page ${page === "settings" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "settings-page", id: "settings-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "settings" && s.leaving !== "settings" ? true : undefined),
      inert: computed(state.page, (page) => page !== "settings" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "settings" ? "true" : undefined),
    },
  }, [
    View({ class: "settings-sidebar", attributes: { n: "settings-sidebar", role: "navigation", "aria-label": "设置菜单" } },
      ui.settings_menu.map((item) => Button({
        store: item.button$,
        class: classNames(["settings-menu-button", computed(state.settings_menu, (menu) => menu === item.name ? "is-active" : "")]),
        attributes: {
          n: `settings-menu-${item.name}`,
          "aria-current": computed(state.settings_menu, (menu) => menu === item.name ? "page" : undefined),
          "aria-controls": `${item.name}-settings`,
        },
      }, [item.title])),
    ),
    View({ class: "settings-content", attributes: { n: "settings-content" } }, [
    View({
      class: "settings-panel",
      attributes: {
        n: "cookie-sync-settings", id: "cookie-sync-settings", role: "region", "aria-label": "Cookie 同步设置",
        hidden: computed(state.settings_menu, (menu) => menu === "cookie-sync" ? undefined : true),
        inert: computed(state.settings_menu, (menu) => menu === "cookie-sync" ? undefined : true),
      },
    }, [
      View({ class: "profile-toolbar", attributes: { n: "profile-toolbar", inert: computed(state.busy, (busy) => busy ? true : undefined) } }, [
        Tabs({
          class: "profile-tabs", attributes: { n: "profile-tabs", "aria-label": "同步接口配置" },
          each: state.profiles, key: "id",
          render(profile) {
            const active = computed(state.active_profile, (id) => id === profile.id);
            return Button({
              store: ui.profile_button(profile.id),
              class: classNames(["profile-tab", computed(active, (selected) => selected ? "is-active" : "")]),
              attributes: { n: "profile-tab", "data-profile-id": profile.id, role: "tab", "aria-selected": computed(active, String), tabindex: computed(active, (selected) => selected ? "0" : "-1") },
            }, [computed(state.profile_titles, (titles) => titles[profile.id])]);
          },
        }),
        Button({ store: ui.add_profile$, attributes: { n: "add-profile-button" } }, ["新增"]),
        Button({ store: ui.remove_profile$, attributes: { n: "remove-profile-button", title: "删除当前配置，至少保留一个已保存配置" } }, ["删除"]),
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
            View({ class: "section-title", attributes: { n: "domain-heading", role: "heading", "aria-level": "2" } }, ["当前接口的同步范围"]),
            View({ class: "domain-list-heading", attributes: { n: "domain-list-heading" } }, [
              Label({ attributes: { n: "domains-label", id: "domains-label" } }, ["域名列表"]),
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
          View({ class: "settings-message", attributes: { n: "settings-message", role: "status", title: state.message, hidden: computed(state.message, (message) => !message ? true : undefined) } }, [state.message]),
        ]),
        View({ class: "settings-actions", attributes: { n: "sync-actions" } }, [
          Button({ store: ui.save$, attributes: { n: "save-button" } }, ["保存当前"]),
          Button({ store: ui.sync$, attributes: { n: "sync-button" } }, ["保存并同步当前"]),
        ]),
      ]),
    ]),
    View({
      class: "settings-panel",
      attributes: {
        n: "savepage-settings", id: "savepage-settings", role: "region", "aria-label": "SavePage 解析设置",
        hidden: computed(state.settings_menu, (menu) => menu === "savepage" ? undefined : true),
        inert: computed(state.settings_menu, (menu) => menu === "savepage" ? undefined : true),
      },
    }, [
      View({ class: "settings-scroll", attributes: { n: "savepage-scroll" } }, [
        Card({ class: "settings-card", attributes: { n: "parser-panel" } }, [
          View({ class: "section-title", attributes: { n: "parser-heading", role: "heading", "aria-level": "2" } }, ["域名解析规则"]),
          View({ class: "parser-list-heading", attributes: { n: "parser-list-heading" } }, [
            Label({ attributes: { n: "parsers-label", id: "parsers-label" } }, ["域名 → 解析器"]),
            Button({ store: ui.add_parser$, attributes: { n: "add-parser-button" } }, ["添加规则"]),
          ]),
          ArrayField({
            store: ui.parsers$, class: "parser-list", attributes: { n: "parsers-array-field", "aria-labelledby": "parsers-label" },
            render({ idx, field }) {
              return View({ class: "parser-row", attributes: { n: "parser-row" } }, [
                Input({ store: field.fields.domain.input, rootAttributes: { n: "parser-domain-wrapper" }, attributes: { n: "parser-domain-input", "aria-label": `第 ${idx + 1} 条规则的域名`, spellcheck: "false" } }),
                Select({ store: field.fields.parser.input, attributes: { n: "parser-type-input", "aria-label": `第 ${idx + 1} 条规则的解析器` } }),
                Button({ store: field.remove$, attributes: { n: "remove-parser-button", "aria-label": `删除第 ${idx + 1} 条规则` } }, ["删除"]),
              ]);
            },
          }),
          View({ class: "page-help", attributes: { n: "parser-list-help" } }, ["域名填写 example.com 即匹配该域名及其子域，也可写 *.example.com 或完整 URL。选「飞书文档」时 SavePage 会提取文件、图片、视频并替换为占位符；选「通用」只移除 script 标签。*.feishu.cn、*.larksuite.com 内置为飞书文档，无需配置。"]),
        ]),
      ]),
      View({ class: "settings-footer", attributes: { n: "parsers-footer" } }, [
        View({ class: "settings-feedback", attributes: { n: "parsers-feedback" } }, [
          View({ class: "settings-message", attributes: { n: "parsers-message", role: "status", title: state.parsers_message, hidden: computed(state.parsers_message, (message) => !message ? true : undefined) } }, [state.parsers_message]),
        ]),
      ]),
    ]),
    ]),
  ]);
}
