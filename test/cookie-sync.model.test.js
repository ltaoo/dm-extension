import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import CryptoJS from "../assets/vendor/crypto-js.js";
import { build_request, default_settings, CookieSyncModel } from "../src/models/sync.model.js";

test("两种 AES 上传兼容原协议，保留域名范围并隐藏密码", () => {
  for (const method of ["legacy", "aes-128-cbc-fixed"]) {
    const settings = default_settings();
    settings.domainFilter.domains = [{ enabled: true, domain: "*.instagram.com" }];
    settings.encryption = { method, uuid: "fixture-uuid", password: "fixture-password" };
    const body = build_request([], settings);
    assert.equal(body.signature, undefined);
    assert.deepEqual(body.domains, ["instagram.com"]);
    const encryption_key = CryptoJS.MD5("fixture-uuid-fixture-password").toString().slice(0, 16);
    const plaintext = method === "legacy" ? CryptoJS.AES.decrypt(body.data, encryption_key)
      : CryptoJS.AES.decrypt({ ciphertext: CryptoJS.enc.Base64.parse(body.data) }, CryptoJS.enc.Utf8.parse(encryption_key), {
        iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000"), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
      });
    assert.equal(plaintext.toString(CryptoJS.enc.Utf8), "[]");
    assert.equal(body.password, undefined);
  }
});

test("同步保留旧接口兼容性，并显示服务端接受数量或错误描述", async () => {
  const data = {};
  const client = {
    storage: { local: { get: async () => structuredClone(data), set: async items => Object.assign(data, structuredClone(items)) } },
    alarms: { getAll: async () => [], clear: async () => {}, create: async () => {} },
    cookies: { getAll: async () => [{ name: "sessionid", value: "fixture", domain: ".instagram.com" }] },
  };
  let response = () => new Response("OK");
  const model = CookieSyncModel(client, async (url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(JSON.parse(options.body).crypto_type, "none");
    return response();
  });
  const settings = default_settings();
  settings.domainFilter.domains = [{ enabled: true, domain: "instagram.com" }];
  let state = await model.run("sync", settings);
  assert.equal(state.statuses.default.cookieCount, 1);
  response = () => Response.json({ code: 0, count: 0, skipped: 1, msg: "成功" });
  state = await model.run("sync", settings);
  assert.equal(state.statuses.default.cookieCount, 0);
  response = () => Response.json({ code: "COOKIE_SYNC_UUID_MISMATCH", message: "UUID 或密码无效" }, { status: 401 });
  state = await model.run("sync", settings);
  assert.equal(state.statuses.default.error, "UUID 或密码无效");
});

test("读取配置不等待正在进行的同步，写入仍按顺序执行", async () => {
  const data = {};
  const client = {
    storage: { local: { get: async () => structuredClone(data), set: async items => Object.assign(data, structuredClone(items)) } },
    alarms: { getAll: async () => [], clear: async () => {}, create: async () => {} },
    cookies: { getAll: async () => [] },
  };
  let release_request;
  const request_gate = new Promise(resolve => { release_request = resolve; });
  let request_started;
  const started = new Promise(resolve => { request_started = resolve; });
  const model = CookieSyncModel(client, async () => {
    request_started();
    await request_gate;
    return new Response("OK");
  });
  const settings = default_settings();
  const syncing = model.run("sync", settings);
  await started;
  let write_finished = false;
  const saving = model.run("save", { ...settings, name: "新名称" }).then(() => { write_finished = true; });
  let snapshot;
  const reading = model.run("get").then(value => { snapshot = value; });
  try {
    await setImmediate();
    assert.ok(snapshot, "慢接口返回前，Popup 必须能读取配置");
    assert.equal(snapshot.statuses.default.syncing, true);
    assert.equal(snapshot.profiles[0].name, settings.name);
    assert.equal(write_finished, false, "保存不能越过正在执行的同步");
    snapshot.profiles[0].name = "外部修改";
    snapshot.statuses.default.syncing = false;
    const next = await model.run("get");
    assert.equal(next.profiles[0].name, settings.name);
    assert.equal(next.statuses.default.syncing, true, "只读响应必须与后台状态隔离");
  } finally {
    release_request();
    await Promise.all([syncing, saving, reading]);
  }
  assert.equal((await model.run("get")).profiles[0].name, "新名称");
});
