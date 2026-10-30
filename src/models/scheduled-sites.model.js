export const scheduled_sites_key = "scheduled-sites";
export const scheduled_jobs_key = "scheduled-site-jobs";
export const visit_alarm_prefix = "scheduled-site-visit:";
export const close_alarm_prefix = "scheduled-site-close:";

export function validate_scheduled_site(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) throw new Error("任务 ID 无效");
  let url;
  try { url = new URL(String(value.url || "").trim()); } catch { throw new Error("请填写完整的 HTTP(S) 网址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("网址须为不含用户名和密码的 HTTP(S) 地址");
  const interval_minutes = Number(value.interval_minutes);
  const duration_seconds = Number(value.duration_seconds);
  if (!Number.isFinite(interval_minutes) || interval_minutes < 0.5 || interval_minutes > 10080) throw new Error("访问间隔须为 0.5～10080 分钟");
  if (!Number.isInteger(duration_seconds) || duration_seconds < 1 || duration_seconds > 86400) throw new Error("停留时间须为 1～86400 秒的整数");
  if (typeof value.enabled !== "boolean") throw new Error("任务开关无效");
  return { id: value.id, url: url.href, interval_minutes, duration_seconds, enabled: value.enabled };
}

export function ScheduledSitesModel(client = chrome) {
  let sites = [];
  let jobs = {};
  let queue = Promise.resolve();
  const timers = new Map();

  async function schedule() {
    const alarms = await client.alarms.getAll();
    for (const alarm of alarms) {
      if (alarm.name.startsWith(visit_alarm_prefix) && !sites.some((site) => site.enabled && alarm.name === visit_alarm_prefix + site.id)) await client.alarms.clear(alarm.name);
      if (alarm.name.startsWith(close_alarm_prefix) && !Object.hasOwn(jobs, alarm.name.slice(close_alarm_prefix.length))) await client.alarms.clear(alarm.name);
    }
    for (const site of sites.filter((site) => site.enabled)) {
      const name = visit_alarm_prefix + site.id;
      if (!alarms.some((alarm) => alarm.name === name && alarm.periodInMinutes === site.interval_minutes)) {
        await client.alarms.create(name, { delayInMinutes: site.interval_minutes, periodInMinutes: site.interval_minutes });
      }
    }
  }

  async function forget_job(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    const next = { ...jobs };
    delete next[id];
    await client.storage.session.set({ [scheduled_jobs_key]: next });
    jobs = next;
    await client.alarms.clear(close_alarm_prefix + id);
  }

  async function close_job(id) {
    const job = Object.hasOwn(jobs, id) ? jobs[id] : undefined;
    if (!job) return;
    let tab;
    try { tab = await client.tabs.get(job.tab_id); }
    catch (error) {
      if (!/No tab with id/i.test(error.message)) throw error;
    }
    // 用户正在查看任务页时保留它，避免自动关闭当前标签。
    if (tab && !tab.active) await client.tabs.remove(job.tab_id);
    await forget_job(id);
  }

  async function arm_close(id) {
    const job = jobs[id];
    if (job.close_at <= Date.now()) return close_job(id);
    await client.alarms.create(close_alarm_prefix + id, { when: job.close_at });
    clearTimeout(timers.get(id));
    // shortcut: 秒级计时辅以闹钟恢复，浏览器休眠或繁忙时关闭可能延迟。
    timers.set(id, setTimeout(() => model.run("close", { id }).catch(console.error), Math.max(0, job.close_at - Date.now())));
  }

  async function visit(site) {
    if (Object.hasOwn(jobs, site.id)) {
      if (jobs[site.id].close_at > Date.now()) return;
      await close_job(site.id);
    }
    const windows = (await client.windows.getAll({ windowTypes: ["normal"] })).filter((window) => !window.incognito);
    const window = windows.find((window) => window.focused) || windows[0];
    if (!window) throw new Error("没有可用的普通浏览器窗口");
    const tab = await client.tabs.create({ windowId: window.id, url: "about:blank", active: false });
    try {
      // 先静音再导航，避免页面在加载瞬间播放声音。
      await client.tabs.update(tab.id, { muted: true });
      jobs = { ...jobs, [site.id]: { tab_id: tab.id, close_at: Date.now() + site.duration_seconds * 1000 } };
      await client.storage.session.set({ [scheduled_jobs_key]: jobs });
      await arm_close(site.id);
      await client.tabs.update(tab.id, { url: site.url });
    } catch (error) {
      // 即使导航或持久化失败，也清理本次创建的空白页。
      await client.tabs.remove(tab.id).catch(console.error);
      await forget_job(site.id);
      throw error;
    }
  }

  const ready = (async () => {
    const saved = await client.storage.local.get(scheduled_sites_key);
    const list = saved[scheduled_sites_key] ?? [];
    if (!Array.isArray(list)) throw new Error("定时访问配置格式错误");
    sites = list.map(validate_scheduled_site);
    if (new Set(sites.map((site) => site.id)).size !== sites.length) throw new Error("任务 ID 重复");
    jobs = (await client.storage.session.get(scheduled_jobs_key))[scheduled_jobs_key] || {};
    await schedule();
    for (const id of Object.keys(jobs)) await arm_close(id);
  })();

  const model = {
    ready,
    run(action, value) {
      const task = queue.then(async () => {
        await ready;
        if (action === "save") {
          const site = validate_scheduled_site(value);
          const next = sites.some((item) => item.id === site.id) ? sites.map((item) => item.id === site.id ? site : item) : [...sites, site];
          await client.storage.local.set({ [scheduled_sites_key]: next });
          sites = next;
          await schedule();
        }
        if (action === "remove") {
          const next = sites.filter((site) => site.id !== value?.id);
          await client.storage.local.set({ [scheduled_sites_key]: next });
          sites = next;
          await schedule();
          await close_job(value.id);
        }
        if (action === "visit" || action === "alarm") {
          const site = sites.find((site) => site.id === value?.id);
          if (!site && action === "visit") throw new Error("任务不存在");
          if (site && (action === "visit" || site.enabled)) await visit(site);
        }
        if (action === "close") {
          if (jobs[value?.id]?.close_at > Date.now()) await arm_close(value.id);
          else await close_job(value?.id);
        }
        return { sites: structuredClone(sites) };
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  return model;
}
