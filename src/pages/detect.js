import { Button } from "../../assets/vendor/src/dmui.js";

const { View, computed, combine, classNames, For } = window.Timeless;

export default function DetectPageView({ store }) {
  const { state, ui } = store;
  return View({
    class: computed(state.page, (page) => `detect-page popup-page ${page === "detect" ? "page-enter" : "page-exit"}`),
    attributes: {
      n: "detect-page", id: "detect-page",
      hidden: combine({ page: state.page, leaving: state.leaving_page }, (s) => s.page !== "detect" && s.leaving !== "detect" ? true : undefined),
      inert: computed(state.page, (page) => page !== "detect" ? true : undefined),
      "aria-hidden": computed(state.page, (page) => page !== "detect" ? "true" : undefined),
    },
  }, [
    View({ class: "detect-toolbar", attributes: { n: "detect-toolbar" } }, [
      View({ class: "section-title", attributes: { n: "detect-heading", role: "heading", "aria-level": "2" } }, ["变更检测规则"]),
      View({ class: "muted detect-count", attributes: { n: "detect-count" } }, [computed(state.detection_count, (count) => `共 ${count} 条`)]),
    ]),
    View({
      class: "detect-feedback",
      attributes: { n: "detect-feedback", role: "status", hidden: computed(state.detection_feedback, (message) => !message ? true : undefined) },
    }, [state.detection_feedback]),
    View({
      class: "detect-notice",
      attributes: { n: "detect-notice", role: "status", hidden: computed(state.script_supported, (supported) => supported ? true : undefined) },
    }, ["未开启「允许用户脚本」：在 chrome://extensions 的扩展详情页打开该开关并重新加载扩展后，JS 函数 / 列表对比规则才能执行；颜色 / 内容规则不受影响。"]),
    View({ class: "detection-rules", attributes: { n: "detection-rules", role: "list", "aria-label": "变更检测规则" } }, [
      For({
        each: state.detection_rows,
        key: "id",
        render(rule) {
          const buttons = ui.rule_button(rule.id);
          // 列表按 key 复用行 DOM，行内随当前页面变化的字段必须走 computed 才会就地更新
          // （规则与当前标签页是并发加载的，首次渲染时 hostname 可能还是空的）。
          const row = computed(state.detection_rows, (rows) => rows.find((item) => item.id === rule.id) || rule);
          // 按 id 取本行结果：computed 按 === 缓存，只有本行结果变化才重渲染。
          const result = computed(state.detection_results, (all) => all[rule.id] || null);
          return View({ class: "detection-rule-row", attributes: { n: "detection-rule-row", role: "listitem" } }, [
            View({ class: "detection-rule-main", attributes: { n: "detection-rule-main" } }, [
              View({ class: "detection-rule-name", attributes: { n: "detection-rule-name" } }, [rule.name]),
              View({ class: "muted detection-rule-shape", attributes: { n: "detection-rule-shape", hidden: computed(row, (item) => item.shape_label ? undefined : true) } }, [computed(row, (item) => item.shape_label)]),
              View({ class: "detection-rule-condition", attributes: { n: "detection-rule-condition", title: rule.selector } }, [computed(row, (item) => item.condition)]),
              View({ class: "muted detection-rule-source", attributes: { n: "detection-rule-source" } }, [`来源 ${rule.hostname || "未知"}`]),
              View({
                // error（函数跑挂 / 注入失败）单独一档，不套「满足 / 不满足」前缀；
                // baseline（首次检测记录基线）同理，直接展示 message。
                class: classNames(["detection-rule-result", computed(result, (value) => {
                  if (!value) return "";
                  if (value.baseline) return "is-baseline";
                  if (value.error) return "is-error";
                  if (value.found === false) return "is-missing";
                  return value.passed ? "is-pass" : "is-fail";
                })]),
                attributes: { n: "detection-rule-result", role: "status", hidden: computed(result, (value) => value ? undefined : true) },
              }, [computed(result, (value) => {
                if (!value) return "";
                if (value.baseline) return value.message;
                if (value.error) return `执行失败：${value.message}`;
                return `${value.found === false ? "未找到" : value.passed ? "满足" : "不满足"}：${value.message}${value.actual ? `（实际：${value.actual}）` : ""}`;
              })]),
              // 列表对比：三行固定 diff（不引入 For），各自按有无内容显隐；条数沿用 counts 的准确值。
              View({
                class: "detection-rule-diff is-added",
                attributes: { n: "detection-rule-diff-added", hidden: computed(result, (value) => value && value.diff && value.diff.added.length ? undefined : true) },
              }, [computed(result, (value) => !value || !value.diff ? "" : `新增 ${value.counts.added}：${value.diff.added.join("、")}${value.counts.added > value.diff.added.length ? "…" : ""}`)]),
              View({
                class: "detection-rule-diff is-updated",
                attributes: { n: "detection-rule-diff-updated", hidden: computed(result, (value) => value && value.diff && value.diff.updated.length ? undefined : true) },
              }, [computed(result, (value) => !value || !value.diff ? "" : `更新 ${value.counts.updated}：${value.diff.updated.map((item) => `${item.key}（${item.fields.join("、")}）`).join("、")}${value.counts.updated > value.diff.updated.length ? "…" : ""}`)]),
              View({
                class: "detection-rule-diff is-removed",
                attributes: { n: "detection-rule-diff-removed", hidden: computed(result, (value) => value && value.diff && value.diff.removed.length ? undefined : true) },
              }, [computed(result, (value) => !value || !value.diff ? "" : `删除 ${value.counts.removed}：${value.diff.removed.join("、")}${value.counts.removed > value.diff.removed.length ? "…" : ""}`)]),
              View({
                class: "muted detection-rule-reason",
                attributes: { n: "detection-rule-reason", hidden: computed(row, (item) => item.detectable ? true : undefined) },
              }, [computed(row, (item) => item.reason)]),
            ]),
            View({ class: "detection-rule-actions", attributes: { n: "detection-rule-actions" } }, [
              Button({ store: buttons.detect, attributes: { n: "detection-rule-detect", "aria-label": `检测 ${rule.name}` } }, ["检测"]),
              Button({ store: buttons.remove, attributes: { n: "detection-rule-remove", "aria-label": `删除规则 ${rule.name}` } }, ["删除"]),
            ]),
          ]);
        },
      }),
      View({
        class: "muted detection-rules-empty",
        attributes: { n: "detection-rules-empty", hidden: computed(state.detection_count, (count) => count ? true : undefined) },
      }, ["暂无变更检测规则，请在暂存记录预览页框选创建"]),
    ]),
    View({ class: "page-help", attributes: { n: "detection-help" } }, [
      "在暂存记录的预览页点「框选」，拖拽框选要检测的内容块即可登记规则；同一张预览页可连续框选多个块，每个框按保存次序编号。规则按来源网站限定：只有当前标签页与规则来源 hostname 相同的规则可检测，其余置灰并给出原因。颜色规则同时比较文字颜色与背景色，任一命中即满足；内容规则按大小写敏感的「包含」匹配；JS 函数规则由你自己写函数体，参数 self 是本次框选、others[编号] 是同一次预览里的其他框，只能读它们的 html / text / items，不能用 DOM API 与布局；列表对比规则也由你写函数体（参数 self），返回 { 键: { 字段: 值 } }，首次检测记录基线、之后按键报告新增 / 更新 / 删除（顺序变化不算变更），有任意变更即满足。检测结果只影响本页展示，不写入暂存记录。",
    ]),
  ]);
}
