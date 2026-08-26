"use strict";
var RAY = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/sdk/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    createRay: () => createRay
  });
  var DEFAULT_FLUSH_AT = 10;
  var SESSION_TIMEOUT_MS = 30 * 60 * 1e3;
  function storedId(storage, key, prefix, maxAgeMs) {
    const fresh = `${prefix}${crypto.randomUUID()}`;
    if (!storage) return fresh;
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const record = JSON.parse(raw);
        if (record.v && (!maxAgeMs || record.t !== void 0 && Date.now() - record.t < maxAgeMs)) {
          return record.v;
        }
      }
      storage.setItem(key, JSON.stringify({ v: fresh, t: Date.now() }));
      return fresh;
    } catch {
      return fresh;
    }
  }
  function createRay(config) {
    const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const flushAt = config.flushAt ?? DEFAULT_FLUSH_AT;
    const queue = [];
    const anonymousId = config.anonymousId ?? storedId(globalThis.localStorage, "ray:anon", "anon_");
    let sessionId = config.sessionId ?? storedId(globalThis.sessionStorage, "ray:sess", "sess_", SESSION_TIMEOUT_MS);
    function envelope(eventType, sessionId2, data) {
      return {
        eventId: `evt_${crypto.randomUUID()}`,
        eventType,
        merchantId: null,
        // Resolved server-side from the site key; client value is ignored.
        websiteId: null,
        sessionId: sessionId2,
        customerId: null,
        anonymousId,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        source: "sdk",
        schemaVersion: 1,
        data
      };
    }
    function send(events) {
      void fetchImpl(`${config.endpoint}/v1/events`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.siteKey}` },
        body: JSON.stringify(events),
        keepalive: true
      }).catch(() => {
      });
    }
    function flush() {
      if (queue.length === 0) return;
      send(queue.splice(0));
    }
    function currentSessionId() {
      if (!config.sessionId) {
        sessionId = storedId(globalThis.sessionStorage, "ray:sess", "sess_", SESSION_TIMEOUT_MS);
      }
      return sessionId;
    }
    function track(eventType, data = {}) {
      queue.push(envelope(eventType, currentSessionId(), data));
      if (queue.length >= flushAt) flush();
    }
    function identify(props) {
      track("customer_identified", { ...props });
    }
    return { track, identify, flush, sessionId: currentSessionId, anonymousId: () => anonymousId };
  }
  return __toCommonJS(index_exports);
})();
