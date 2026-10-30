import { createInputStore } from "../../assets/vendor/src/dmui.js";

const { ref, computed, combine, vm } = globalThis.Timeless;

export function ScheduledSitesViewModel(client = chrome, show_message) {
  const sites = ref([]);
  const saved_sites = ref([]);
  const busy = ref(false);
  const loaded = ref(false);
  const records = new Map();

  function is_dirty(site) {
    const saved = saved_sites.value.find((item) => item.id === site.id);
    return !saved || site.url !== saved.url || Number(site.interval_minutes) !== saved.interval_minutes || Number(site.duration_seconds) !== saved.duration_seconds;
  }

  async function send(action, value, feedback) {
    if (busy.value) return;
    busy.as(true);
    show_message("");
    try {
      const response = await client.runtime.sendMessage({ action: "scheduled-sites", command: action, value });
      if (!response?.success) throw new Error(response?.error || "后台未响应，请重新加载扩展");
      saved_sites.as(response.sites);
      if (action === "get") sites.as(response.sites);
      if (action === "save") sites.as(sites.value.map((site) => site.id === value.id ? response.sites.find((item) => item.id === value.id) : site));
      if (action === "remove") sites.as(sites.value.filter((site) => site.id !== value.id));
      loaded.as(true);
      show_message(feedback || "");
      return true;
    } catch (error) {
      show_message(error.message);
      return false;
    } finally {
      busy.as(false);
    }
  }

  const methods = {
    load() { if (!loaded.value) return send("get"); },
    add() {
      if (busy.value || !loaded.value) return;
      const site = { id: crypto.randomUUID(), url: "", interval_minutes: 30, duration_seconds: 3, enabled: true };
      sites.as([site, ...sites.value]);
      show_message("新任务尚未保存");
      queueMicrotask(() => ui.record(site.id).url.focus());
    },
    update(id, field, value) {
      if (!busy.value) sites.as(sites.value.map((site) => site.id === id ? { ...site, [field]: value } : site));
    },
    save(id) {
      const site = sites.value.find((site) => site.id === id);
      if (site) return send("save", site, "任务已保存，将按设定间隔自动访问");
    },
    async remove(id) {
      if (busy.value) return;
      if (saved_sites.value.some((site) => site.id === id)) {
        if (!await send("remove", { id }, "任务已删除")) return;
      } else {
        sites.as(sites.value.filter((site) => site.id !== id));
        show_message("未保存的任务已删除");
      }
      records.delete(id);
    },
  };
  const ui = {
    add: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: methods.add }),
    record(id) {
      if (!records.has(id)) {
        const current = computed(sites, (list) => list.find((site) => site.id === id));
        const dirty = combine({ sites, saved_sites }, () => current.value ? is_dirty(current.value) : false);
        const saved = computed(saved_sites, (list) => list.some((site) => site.id === id));
        const controls = {
          enabled: computed(current, (site) => Boolean(site?.enabled)),
          status: combine({ current, saved, dirty }, (s) => !s.saved ? "未保存" : `${s.current?.enabled ? "已启用" : "已暂停"}${s.dirty ? " · 有未保存修改" : ""}`),
          save: new vm.ButtonCore({ variant: "primary", size: "sm", onClick: () => methods.save(id) }),
          toggle: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: () => send("save", { ...current.value, enabled: !current.value.enabled }, "任务开关已保存") }),
          visit: new vm.ButtonCore({ variant: "outline", size: "sm", onClick: () => send("visit", { id }, "已在后台访问；若上次任务仍在运行则跳过") }),
          remove: new vm.ButtonCore({ variant: "ghost", size: "sm", onClick: () => methods.remove(id) }),
        };
        for (const field of ["url", "interval_minutes", "duration_seconds"]) {
          controls[field] = createInputStore({
            value: computed(current, (site) => String(site?.[field] ?? "")), disabled: busy,
            type: field === "url" ? "text" : "number", allowClear: false,
            placeholder: field === "url" ? "https://example.com/" : "",
            onChange: (value) => methods.update(id, field, value),
          });
        }
        for (const [button, disabled] of [
          [controls.save, busy], [controls.remove, busy],
          [controls.toggle, combine({ busy, saved, dirty }, (s) => s.busy || !s.saved || s.dirty)],
          [controls.visit, combine({ busy, saved, dirty }, (s) => s.busy || !s.saved || s.dirty)],
        ]) {
          const update = (value) => value ? button.disable() : button.enable();
          update(disabled.value);
          disabled.subscribe({ onChange: update });
        }
        records.set(id, controls);
      }
      return records.get(id);
    },
  };
  const add_disabled = combine({ busy, loaded }, (s) => s.busy || !s.loaded);
  const update_add = (value) => value ? ui.add.disable() : ui.add.enable();
  update_add(add_disabled.value);
  add_disabled.subscribe({ onChange: update_add });
  return { state: { sites, busy }, ui, methods };
}
