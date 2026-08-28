import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPublicUrl } from "../src/common/security/ssrf";

const blocked = [
  "http://127.0.0.1:8080/x",
  "https://169.254.169.254/latest/meta-data",
  "http://10.0.0.5/x",
  "http://192.168.1.1",
  "http://172.16.0.1/x",
  "http://0.0.0.0",
  "http://localhost/x",
  "http://[::1]/x",
  "file:///etc/passwd",
  "gopher://evil/x",
];

const allowed = [
  "https://api.openai.com/v1/chat/completions",
  "https://api.anthropic.com/v1/messages",
  "https://generativelanguage.googleapis.com/v1beta/models",
];

for (const url of blocked) {
  test(`ssrf: blocks ${url}`, () => {
    assert.throws(() => assertPublicUrl(url));
  });
}

for (const url of allowed) {
  test(`ssrf: allows ${url}`, () => {
    assert.doesNotThrow(() => assertPublicUrl(url));
  });
}
