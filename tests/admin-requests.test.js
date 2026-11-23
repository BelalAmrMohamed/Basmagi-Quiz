import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const adminSrc = fs.readFileSync(new URL("../api/admin.js", import.meta.url), "utf8");
const indexHtml = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const signInJs = fs.readFileSync(new URL("../public/src/components/log-in/sign-in.js", import.meta.url), "utf8");
const controlHtml = fs.readFileSync(new URL("../public/control.html", import.meta.url), "utf8");
const controlJs = fs.readFileSync(new URL("../public/src/features/control/control.js", import.meta.url), "utf8");

test("api/admin.js routes request_admin public action and control actions", () => {
  assert.match(adminSrc, /action === "request_admin"/);
  assert.match(adminSrc, /handleAdminRequest\(req, res\)/);

  // CONTROL_ACTIONS set
  const controlMatch = adminSrc.match(/const CONTROL_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(controlMatch, "CONTROL_ACTIONS should be defined");
  const actions = new Set([...controlMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

  assert.ok(actions.has("approve_admin_request"), "approve_admin_request in CONTROL_ACTIONS");
  assert.ok(actions.has("reject_admin_request"), "reject_admin_request in CONTROL_ACTIONS");
  assert.ok(actions.has("delete_admin_request"), "delete_admin_request in CONTROL_ACTIONS");

  // Post handler branches
  assert.match(adminSrc, /action === "approve_admin_request"/);
  assert.match(adminSrc, /action === "reject_admin_request"/);
  assert.match(adminSrc, /action === "delete_admin_request"/);

  // Get handler fetches admin_requests
  assert.match(adminSrc, /\.from\("admin_requests"\)/);
  assert.match(adminSrc, /adminRequests:\s*adminRequests \|\| \[\]/);
});

test("index.html and sign-in.js dialog contain required request elements", () => {
  for (const [name, markup] of [["index.html", indexHtml], ["sign-in.js", signInJs]]) {
    assert.ok(markup.includes('id="sd-rejectionStep"') || markup.includes('id=\\"sd-rejectionStep\\"'), `${name} has sd-rejectionStep`);
    assert.ok(markup.includes('id="sd-requestStep"') || markup.includes('id=\\"sd-requestStep\\"'), `${name} has sd-requestStep`);
    assert.ok(markup.includes('id="sd-reqEmail"') || markup.includes('id=\\"sd-reqEmail\\"'), `${name} has sd-reqEmail`);
    assert.ok(markup.includes('id="sd-reqName"') || markup.includes('id=\\"sd-reqName\\"'), `${name} has sd-reqName`);
    assert.ok(markup.includes('id="sd-reqReason"') || markup.includes('id=\\"sd-reqReason\\"'), `${name} has sd-reqReason`);
    assert.ok(markup.includes('id="sd-reqSubmitBtn"') || markup.includes('id=\\"sd-reqSubmitBtn\\"'), `${name} has sd-reqSubmitBtn`);
    assert.ok(markup.includes('id="sd-requestDirectLink"') || markup.includes('id=\\"sd-requestDirectLink\\"'), `${name} has sd-requestDirectLink`);
  }
});

test("control.html and control.js have admin requests section and functions", () => {
  assert.ok(controlHtml.includes('id="requestsNavBtn"'), "control.html has requestsNavBtn");
  assert.ok(controlHtml.includes('id="requestsSection"'), "control.html has requestsSection");
  assert.ok(controlHtml.includes('id="requestsBadge"'), "control.html has requestsBadge");
  assert.ok(controlHtml.includes('id="requestsList"'), "control.html has requestsList");

  assert.match(controlJs, /renderRequestsList/);
  assert.match(controlJs, /approveAdminRequest/);
  assert.match(controlJs, /rejectAdminRequest/);
  assert.match(controlJs, /deleteAdminRequest/);
});
