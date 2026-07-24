import { chromium } from "@playwright/test";

const endpoint = process.env.JSTREMIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages().find((candidate) => candidate.url().includes("web.stremio.com"));
if (!page) throw new Error("JStremio WebView page was not found");
await page.waitForFunction(() => Boolean(window.JStremio));
await page.locator('[data-jstremio-testid="plugin-manager-navigation"]').click();
const restart = page.locator(".plugins-shell .restart");
await restart.waitFor({ state: "attached", timeout: 5_000 });
const initiallyHidden = await restart.evaluate((element) => element.hidden && getComputedStyle(element).display === "none");
if (!initiallyHidden) throw new Error("The plugin restart notice was visible before a plugin change");
const result = await page.evaluate(() => window.JStremio.bridge.request("plugins", "restart", {}, { timeoutMs: 2_000 }));
console.log(JSON.stringify({ initiallyHidden, bridgeResult: result }));
// Let the native restart timer close the original process before the PowerShell
// smoke-test harness performs its normal cleanup.
await new Promise((resolve) => setTimeout(resolve, 2_000));
