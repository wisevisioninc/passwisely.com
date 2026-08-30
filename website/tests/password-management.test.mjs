import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("password recovery avoids account enumeration and uses Supabase recovery", async () => {
  const [route, supabase] = await Promise.all([
    read("../app/api/auth/forgot-password/route.ts"),
    read("../lib/supabase.ts"),
  ]);
  assert.match(route, /return Response\.json\(\{ success: true \}\)/);
  assert.match(route, /requestPasswordReset/);
  assert.match(supabase, /\/auth\/v1\/recover\?redirect_to=/);
});

test("password changes require current credentials and validate the replacement", async () => {
  const route = await read("../app/api/auth/change-password/route.ts");
  assert.match(route, /signInWithPassword\(user\.email, currentPassword\)/);
  assert.match(route, /validatePassword\(newPassword\)/);
  assert.match(route, /updateAuthUserPassword\(user\.id, newPassword\)/);
});

test("website and desktop expose forgot and change password controls", async () => {
  const [site, desktopAuth, preload] = await Promise.all([
    read("../app/PassWiselySite.tsx"),
    read("../../src/_pages/AuthPage.tsx"),
    read("../../electron/preload.ts"),
  ]);
  assert.match(site, /forgotPassword/);
  assert.match(site, /changePassword/);
  assert.match(desktopAuth, /accountForgotPassword/);
  assert.match(preload, /accountChangePassword/);
});

test("desktop login uses the app icon, precise errors, and a quit control", async () => {
  const [site, preload, handlers, login, accountService] = await Promise.all([
    read("../../src/_pages/AuthPage.tsx"),
    read("../../electron/preload.ts"),
    read("../../electron/ipcHandlers.ts"),
    read("../app/api/auth/login/route.ts"),
    read("../../electron/account.ts"),
  ]);
  assert.match(site, /src="\.\/logo512\.png"/);
  assert.doesNotMatch(site, />\s*P\s*</);
  assert.match(site, /账号邮箱不存在/);
  assert.match(site, /密码不正确/);
  assert.match(site, /window\.electronAPI\.quitApp/);
  assert.match(preload, /ipcRenderer\.invoke\("quit-app"\)/);
  assert.match(handlers, /ipcMain\.handle\("quit-app"/);
  assert.match(login, /"email_not_found"/);
  assert.match(login, /"invalid_password"/);
  assert.match(
    accountService,
    /if \(!this\.getToken\(\)\) return \{ success: false \}/,
  );
});
