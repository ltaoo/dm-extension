import assert from "node:assert/strict";
import test from "node:test";
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
