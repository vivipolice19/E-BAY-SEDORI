/**
 * Playwright 1.58+ は headless 起動に chromium-headless-shell を使う。
 * `playwright install chromium` だけでは不足するため、両方入れる。
 * Render では RENDER=true の間に npm install が走るのでここで取得する。
 */
import { spawnSync } from "node:child_process";

const PW_VERSION = "1.58.2";

if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1") {
  console.log("[playwright-postinstall] skipped (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1)");
  process.exit(0);
}

// ローカルでは任意。Render / CI では必須に近い。
const shouldInstall =
  process.env.RENDER === "true" ||
  process.env.CI === "true" ||
  process.env.FORCE_PLAYWRIGHT_INSTALL === "1";

if (!shouldInstall) {
  console.log(
    "[playwright-postinstall] skipped (set RENDER=true, CI=true, or FORCE_PLAYWRIGHT_INSTALL=1 to install browsers)",
  );
  process.exit(0);
}

console.log(`[playwright-postinstall] npx playwright@${PW_VERSION} install chromium chromium-headless-shell …`);
const res = spawnSync(
  "npx",
  ["-y", `playwright@${PW_VERSION}`, "install", "chromium", "chromium-headless-shell"],
  { stdio: "inherit", shell: true, env: process.env },
);

if (res.status !== 0) {
  console.error("[playwright-postinstall] playwright install failed with status", res.status);
  if (process.env.RENDER === "true") process.exit(res.status || 1);
}
process.exit(0);
