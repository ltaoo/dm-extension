import assert from "node:assert/strict";
import test from "node:test";
import { close_alarm_prefix, scheduled_jobs_key, scheduled_sites_key, ScheduledSitesModel, validate_scheduled_site, visit_alarm_prefix } from "../src/models/scheduled-sites.model.js";

const site = { id: "fixture", url: "https://example.com/", interval_minutes: 1, duration_seconds: 5, enabled: true };

function fixture(local = {}, session = {}) {
  const alarms = new Map([["cookie-sync:default", { name: "cookie-sync:default", periodInMinutes: 1 }]]);
  const tabs = new Map([[1, { id: 1, active: true, url: "https://youtube.com/watch?v=fixture" }]]);
  const calls = [];
  let next_id = 2;
  const storage = (data) => ({
    get: async () => structuredClone(data),
    set: async (items) => Object.assign(data, structuredClone(items)),
  });
  const client = {
    storage: { local: storage(local), session: storage(session) },
    windows: { getAll: async () => [{ id: 10, focused: true }] },
    alarms: {
      getAll: async () => [...alarms.values()],
      create: async (name, options) => alarms.set(name, { name, ...options }),
      clear: async (name) => alarms.delete(name),
    },
    tabs: {
      create: async (options) => {
        calls.push(["create", options]);
        const tab = { ...options, id: next_id++ };
        tabs.set(tab.id, tab);
        return tab;
      },
      update: async (id, options) => { calls.push(["update", id, options]); Object.assign(tabs.get(id), options); },
      get: async (id) => {
        if (!tabs.has(id)) throw new Error(`No tab with id: ${id}.`);
        return tabs.get(id);
      },
      remove: async (id) => { calls.push(["remove", id]); tabs.delete(id); },
    },
  };
  return { client, local, session, alarms, tabs, calls };
}

test("校验网址、间隔、停留秒数和任务开关", () => {
  assert.deepEqual(validate_scheduled_site({ ...site, interval_minutes: "0.5", duration_seconds: "10" }), { ...site, interval_minutes: 0.5, duration_seconds: 10 });
  for (const value of [
    { url: "javascript:alert(1)" }, { url: "file:///etc/hosts" }, { url: "https://user:secret@example.com" }, { url: "example.com" },
    { interval_minutes: 0.1 }, { interval_minutes: Infinity }, { duration_seconds: 0 }, { duration_seconds: 1.5 },
    { duration_seconds: 86401 }, { enabled: "true" }, { id: "../other" },
  ]) assert.throws(() => validate_scheduled_site({ ...site, ...value }));
});

test("后台打开并先静音，秒级关闭只删除新标签，不切换视频页", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
  const f = fixture();
  const model = ScheduledSitesModel(f.client);
  await model.run("save", site);
  assert.equal(f.alarms.get(visit_alarm_prefix + site.id).periodInMinutes, 1);
  await model.run("visit", { id: site.id });
  assert.deepEqual(f.calls.slice(0, 3), [
    ["create", { windowId: 10, url: "about:blank", active: false }],
    ["update", 2, { muted: true }], ["update", 2, { url: site.url }],
  ]);
  assert.equal(f.session[scheduled_jobs_key].fixture.close_at, 105000);
  await model.run("alarm", { id: site.id });
  assert.equal(f.tabs.size, 2, "上次运行未结束时不能重复打开");
  t.mock.timers.tick(5000);
  await model.run("get");
  assert.deepEqual([...f.tabs.keys()], [1]);
  assert.equal(f.tabs.get(1).active, true);
  assert.equal(f.alarms.has(close_alarm_prefix + site.id), false);
  assert.equal(f.alarms.has("cookie-sync:default"), true);
});

test("后台重启恢复关闭任务；浏览器新会话不使用旧标签 ID", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
  const f = fixture({ [scheduled_sites_key]: [site] }, { [scheduled_jobs_key]: { fixture: { tab_id: 2, close_at: 102000 } } });
  f.tabs.set(2, { id: 2, active: false });
  const model = ScheduledSitesModel(f.client);
  await model.ready;
  t.mock.timers.tick(2000);
  await model.run("get");
  assert.deepEqual([...f.tabs.keys()], [1]);
  const new_session = fixture({ [scheduled_sites_key]: [site] });
  new_session.alarms.set(close_alarm_prefix + site.id, { name: close_alarm_prefix + site.id });
  const next = ScheduledSitesModel(new_session.client);
  await next.run("close", { id: site.id });
  assert.deepEqual([...new_session.tabs.keys()], [1]);
  assert.equal(new_session.alarms.has(close_alarm_prefix + site.id), false);
});

test("暂停、编辑、删除更新闹钟；手动查看的任务页保留", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
  const f = fixture();
  const model = ScheduledSitesModel(f.client);
  await model.run("save", site);
  await model.run("save", { ...site, interval_minutes: 2 });
  assert.equal(f.alarms.get(visit_alarm_prefix + site.id).periodInMinutes, 2);
  await model.run("save", { ...site, enabled: false });
  await model.run("alarm", { id: site.id });
  assert.equal(f.tabs.size, 1);
  assert.equal(f.alarms.has(visit_alarm_prefix + site.id), false);
  await model.run("visit", { id: site.id });
  f.tabs.get(2).active = true;
  t.mock.timers.tick(5000);
  await model.run("get");
  assert.equal(f.tabs.has(2), true);
  assert.deepEqual(f.session[scheduled_jobs_key], {});
  await model.run("remove", { id: site.id });
  assert.deepEqual(f.local[scheduled_sites_key], []);
});

test("导航失败和手动关页可清理；无窗口时不新建窗口", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100000 });
  const f = fixture();
  const model = ScheduledSitesModel(f.client);
  await model.run("save", site);
  const update = f.client.tabs.update;
  f.client.tabs.update = async (id, value) => {
    if (value.url) throw new Error("navigation failed");
    return update(id, value);
  };
  await assert.rejects(model.run("visit", { id: site.id }), /navigation failed/);
  assert.deepEqual([...f.tabs.keys()], [1]);
  assert.deepEqual(f.session[scheduled_jobs_key], {});
  f.client.tabs.update = update;
  await model.run("visit", { id: site.id });
  f.tabs.delete(3);
  t.mock.timers.tick(5000);
  await model.run("get");
  assert.deepEqual(f.session[scheduled_jobs_key], {});
  f.client.windows.getAll = async () => [];
  await assert.rejects(model.run("visit", { id: site.id }), /没有可用/);
  assert.equal(f.tabs.size, 1);
});
