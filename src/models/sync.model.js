import CryptoJS from "../../assets/vendor/crypto-js.js";

export const settings_key = "cookie-sync-settings";
export const status_key = "cookie-sync-status";
export const alarm_name = "cookie-sync";

export function default_settings(id = "default", name = "默认配置") {
  return {
    id, name,
    enabled: false,
    endpoint: "http://127.0.0.1:2022/api/cookies/update",
    intervalMinutes: 1,
    domainFilter: { domains: [{ enabled: true, domain: "" }] },
    encryption: { method: "none", uuid: "", password: "" },
  };
}

function normalize_domain(rule) {
  let value = rule.trim().toLowerCase();
  if (value === "*" || value === "<all_urls>") return "*";
  value = value.replace(/^(?:[a-z][a-z\d+.-]*|\*):\/\//i, "")
    .replace(/^\/\//, "").replace(/^\*\./, "").replace(/^\./, "");
  const authority = value.split(/[/?#]/, 1)[0];
  if (!authority) return "";
  try {
    return new URL(`http://${authority}`).hostname.replace(/^\.|\.$/g, "");
  } catch {
    return "";
  }
}

export function domain_rules(value) {
  if (Array.isArray(value)) value = value.filter((row) => row.enabled).map((row) => row.domain).join("\n");
  return [...new Set(value.split(/\r?\n/)
    .flatMap((line) => line.split("#", 1)[0].split(/[,;\s]+/))
    .map(normalize_domain).filter(Boolean))];
}

export function filter_cookies(cookies, filter) {
  const rules = domain_rules(filter.domains);
  return cookies.filter((cookie) => {
    const domain = normalize_domain(cookie.domain || "");
    return rules.some((rule) => domain && (
      rule === "*" || domain === rule || domain.endsWith(`.${rule}`)
    ));
  });
}

export function validate_settings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("同步配置格式错误");
  const settings = structuredClone(value);
  if (typeof settings.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(settings.id)) throw new Error("同步配置 ID 无效");
  settings.name = String(settings.name || "").trim();
  if (!settings.name) throw new Error("请填写配置名称");
  settings.endpoint = String(settings.endpoint || "").trim();
  let endpoint;
  try {
    endpoint = new URL(settings.endpoint);
  } catch {
    throw new Error("请填写有效的同步接口地址");
  }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("同步接口须为不含用户名和密码的 HTTP(S) 地址");
  }
  settings.intervalMinutes = Number(settings.intervalMinutes);
  if (!Number.isFinite(settings.intervalMinutes) || settings.intervalMinutes < 0.5 || settings.intervalMinutes > 1440) {
    throw new Error("同步间隔须在 0.5～1440 分钟之间");
  }
  if (typeof settings.enabled !== "boolean" || !settings.domainFilter || typeof settings.domainFilter !== "object" || Array.isArray(settings.domainFilter)) {
    throw new Error("同步配置格式错误");
  }
  if (typeof settings.domainFilter.domains === "string") {
    settings.domainFilter.domains = domain_rules(settings.domainFilter.domains).map((domain) => ({ enabled: true, domain }));
  }
  if (!Array.isArray(settings.domainFilter.domains)) throw new Error("域名列表格式错误");
  if (!settings.domainFilter.domains.length) settings.domainFilter.domains = default_settings().domainFilter.domains;
  for (const [index, row] of settings.domainFilter.domains.entries()) {
    if (!row || typeof row.enabled !== "boolean" || typeof row.domain !== "string") throw new Error("域名规则格式错误");
    if (row.enabled && row.domain.trim() && domain_rules(row.domain).length !== 1) throw new Error(`第 ${index + 1} 行请填写一个有效域名`);
  }
  delete settings.domainFilter.onlyUpload;
  const encryption = settings.encryption;
  if (!encryption || !["none", "legacy", "aes-128-cbc-fixed"].includes(encryption.method)) {
    throw new Error("不支持的加密方式");
  }
  encryption.uuid = String(encryption.uuid || "").trim();
  if (encryption.method !== "none" && (!encryption.uuid || typeof encryption.password !== "string" || !encryption.password)) {
    throw new Error("加密同步需要填写 UUID 和密码");
  }
  return settings;
}

export function build_request(cookies, settings) {
  const cookie_data = Object.create(null);
  for (const cookie of cookies) (cookie_data[cookie.domain] ??= []).push(cookie);
  const data = { cookies, cookie_data, local_storage_data: {}, update_time: new Date().toISOString() };
  const { method, uuid, password } = settings.encryption;
  if (method === "none") return { ...data, crypto_type: "none" };
  const key = CryptoJS.MD5(`${uuid}-${password}`).toString().substring(0, 16);
  const plaintext = JSON.stringify(data);
  const encrypted = method === "legacy"
    ? CryptoJS.AES.encrypt(plaintext, key).toString()
    : CryptoJS.AES.encrypt(plaintext, CryptoJS.enc.Utf8.parse(key), {
      iv: CryptoJS.enc.Hex.parse("00000000000000000000000000000000"),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }).ciphertext.toString(CryptoJS.enc.Base64);
  return { uuid, encrypted, crypto_type: method };
}

export function CookieSyncModel(client = chrome, request = fetch) {
  let profiles = [default_settings()];
  let statuses = {};
  let queue = Promise.resolve();

  async function schedule() {
    const alarms = await client.alarms.getAll();
    for (const alarm of alarms) {
      if (alarm.name === alarm_name || (alarm.name.startsWith(`${alarm_name}:`) &&
        !profiles.some((profile) => profile.enabled && alarm.name === `${alarm_name}:${profile.id}`))) {
        await client.alarms.clear(alarm.name);
      }
    }
    for (const profile of profiles.filter((item) => item.enabled)) {
      const name = `${alarm_name}:${profile.id}`;
      const alarm = alarms.find((item) => item.name === name);
      if (!alarm || alarm.periodInMinutes !== profile.intervalMinutes) {
        await client.alarms.create(name, {
          delayInMinutes: profile.intervalMinutes,
          periodInMinutes: profile.intervalMinutes,
        });
      }
    }
  }

  async function save_status(id, patch) {
    statuses = { ...statuses, [id]: { ...statuses[id], ...patch } };
    await client.storage.local.set({ [status_key]: statuses });
  }

  const ready = (async () => {
    const saved = await client.storage.local.get([settings_key, status_key]);
    const previous = saved[settings_key];
    const legacy = previous && !Object.hasOwn(previous, "profiles");
    if (legacy) {
      profiles = [validate_settings({ ...default_settings(), ...previous })];
      statuses = saved[status_key] ? { [profiles[0].id]: saved[status_key] } : {};
    } else if (previous) {
      if (!Array.isArray(previous.profiles) || !previous.profiles.length) throw new Error("同步配置列表格式错误");
      profiles = previous.profiles.map(validate_settings);
      if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error("同步配置 ID 重复");
      statuses = Object.fromEntries(profiles.map((profile) => [profile.id, saved[status_key]?.[profile.id] || {}]));
    }
    if (!previous || legacy || JSON.stringify(previous.profiles) !== JSON.stringify(profiles)) {
      await client.storage.local.set({ [settings_key]: { profiles }, [status_key]: statuses });
    }
    for (const profile of profiles) {
      if (statuses[profile.id]?.syncing) {
        await save_status(profile.id, { syncing: false, error: "上次同步中断，请重试", message: "上次同步中断，请重试" });
      }
    }
    await schedule();
  })();

  async function sync(profile) {
    const id = profile.id;
    await save_status(id, { syncing: true, error: "", message: "正在同步 Cookie…", lastAttemptAt: new Date().toISOString() });
    try {
      const cookies = filter_cookies(await client.cookies.getAll({}), profile.domainFilter);
      const response = await request(profile.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        redirect: "error",
        body: JSON.stringify(build_request(cookies, profile)),
        signal: AbortSignal.timeout(20000),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`同步接口返回 HTTP ${response.status}`);
      let payload;
      try { payload = JSON.parse(text); } catch { /* 兼容返回纯文本的同步接口。 */ }
      if (payload && ((payload.code !== undefined && payload.code !== 0) || payload.success === false)) {
        throw new Error(String(payload.msg || payload.message || "同步接口返回失败"));
      }
      await save_status(id, { syncing: false, error: "", message: `已同步 ${cookies.length} 项 Cookie`, cookieCount: cookies.length, lastSuccessAt: new Date().toISOString() });
    } catch (error) {
      await save_status(id, { syncing: false, error: error.message, message: `同步失败：${error.message}` });
    }
  }

  return {
    ready,
    run(action, value) {
      // ponytail: 后台操作串行；单接口请求最多等待 20 秒，高频同步时再按接口拆队列。
      const task = queue.then(async () => {
        await ready;
        if (action === "save" || action === "sync") {
          const profile = validate_settings(value);
          const exists = profiles.some((item) => item.id === profile.id);
          const next = exists ? profiles.map((item) => item.id === profile.id ? profile : item) : [...profiles, profile];
          await client.storage.local.set({ [settings_key]: { profiles: next } });
          profiles = next;
          await schedule();
          if (action === "sync") await sync(profile);
        }
        if (action === "remove") {
          if (!profiles.some((profile) => profile.id === value?.id)) throw new Error("同步配置不存在");
          if (profiles.length === 1) throw new Error("至少保留一个同步配置");
          const next = profiles.filter((profile) => profile.id !== value.id);
          const next_statuses = { ...statuses };
          delete next_statuses[value.id];
          await client.storage.local.set({ [settings_key]: { profiles: next }, [status_key]: next_statuses });
          profiles = next;
          statuses = next_statuses;
          await schedule();
        }
        if (action === "alarm") {
          const profile = profiles.find((item) => item.id === value?.id);
          if (profile?.enabled) await sync(structuredClone(profile));
        }
        return { profiles: structuredClone(profiles), statuses: structuredClone(statuses) };
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}
