import styles from "./styles.css";
import type { JStremioRuntime } from "../../runtime/types";
import { addStyles, mountNavigationButton, removeOwned, requireRuntime } from "../shared";

type Plugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  builtIn: boolean;
  enabled: boolean;
  core: boolean;
  error: string | null;
};

const manifest = {
  schemaVersion: 1,
  id: "plugin-manager",
  name: "Plugins",
  version: "1.0.0",
  entry: "index.js",
  styles: "styles.css",
  enabledByDefault: true,
  loadOrder: 10,
} as const;

const PLUGIN_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 3.5h2V6a2 2 0 0 0 4 0V3.5h2a2 2 0 0 1 2 2v2h-2.5a2 2 0 0 0 0 4H18.5v2a2 2 0 0 1-2 2h-2V18a2 2 0 0 1-4 0v-2.5h-2a2 2 0 0 1-2-2v-2H4a2 2 0 0 1 0-4h2.5v-2a2 2 0 0 1 2-2Z"/></svg>';
const CLOSE_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

requireRuntime().registerExtension(manifest, (runtime) => activate(runtime));

function activate(runtime: JStremioRuntime) {
  const openManager = () => {
    runtime.ui.openOverlay((container, close) => {
      addStyles(container, styles);
      const shell = document.createElement("main");
      shell.className = "plugins-shell";
      shell.innerHTML = `
        <header class="plugins-header"><div><h1>Plugins</h1><p>Enable built-in features and trusted local plugins.</p></div><button class="button icon-button" data-action="close" aria-label="Close Plugins">${CLOSE_ICON}</button></header>
        <section class="warning"><strong>Local plugins are trusted code.</strong><span>They run inside Stremio's WebView and can access the page. Install plugins only from authors you trust.</span></section>
        <div class="toolbar"><button class="button" data-action="folder">Open plugins folder</button><button class="button" data-action="refresh">Refresh status</button></div>
        <div class="restart" role="status" hidden>Plugin changes were saved. Fully restart JStremio to apply them.</div>
        <section class="status" role="status">Loading plugins…</section><section class="plugin-grid" hidden></section>
        <section class="install-help"><h2>Add a local plugin</h2><ol><li>Create a folder under <code>%LOCALAPPDATA%\\JStremio\\plugins</code>.</li><li>Add <code>manifest.json</code>, <code>index.js</code>, and <code>styles.css</code>.</li><li>Restart JStremio, enable the plugin here, then restart once more.</li></ol><p>User plugins start disabled, even if their manifest requests otherwise.</p></section>`;
      container.append(shell);
      const grid = shell.querySelector<HTMLElement>(".plugin-grid")!;
      const status = shell.querySelector<HTMLElement>(".status")!;
      const restart = shell.querySelector<HTMLElement>(".restart")!;
      const load = async () => {
        status.hidden = false;
        grid.hidden = true;
        status.textContent = "Loading plugins…";
        try {
          const plugins = asPlugins(await runtime.bridge.request("plugins", "list"));
          renderPlugins(runtime, grid, plugins, restart);
          status.hidden = plugins.length > 0;
          grid.hidden = plugins.length === 0;
          status.textContent = plugins.length ? "" : "No plugins were discovered.";
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : "Plugin state is unavailable.";
        }
      };
      shell.querySelector('[data-action="close"]')?.addEventListener("click", close);
      shell.querySelector('[data-action="refresh"]')?.addEventListener("click", () => void load());
      shell.querySelector('[data-action="folder"]')?.addEventListener("click", () => {
        void runtime.bridge.request("plugins", "openPluginsFolder").catch((error) => {
          status.hidden = false;
          status.textContent = error instanceof Error ? error.message : "The plugins folder could not be opened.";
        });
      });
      void load();
    });
  };
  const reconcile = () => mountNavigationButton("plugin-manager", "Plugins", PLUGIN_ICON, openManager);
  const unsubscribe = runtime.lifecycle.onReconcile(reconcile);
  return () => {
    unsubscribe();
    runtime.ui.closeOverlay();
    removeOwned("plugin-manager");
  };
}

function renderPlugins(
  runtime: JStremioRuntime,
  grid: HTMLElement,
  plugins: Plugin[],
  restart: HTMLElement,
) {
  grid.replaceChildren();
  for (const plugin of plugins) {
    const card = document.createElement("article");
    card.className = `plugin-card${plugin.error ? " invalid" : ""}`;
    const heading = document.createElement("div");
    heading.className = "plugin-heading";
    const title = document.createElement("h2");
    title.textContent = plugin.name;
    const badges = document.createElement("div");
    badges.className = "badges";
    badges.textContent = plugin.builtIn ? "Built-in" : "Local";
    heading.append(title, badges);
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = [plugin.version && `v${plugin.version}`, plugin.author].filter(Boolean).join(" · ");
    const description = document.createElement("p");
    description.textContent = plugin.error || plugin.description || "No description provided.";
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-row";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = plugin.enabled;
    toggle.disabled = plugin.core || Boolean(plugin.error);
    toggle.setAttribute("aria-label", `${plugin.enabled ? "Disable" : "Enable"} ${plugin.name}`);
    const toggleText = document.createElement("span");
    toggleText.textContent = plugin.core ? "Required" : plugin.enabled ? "Enabled" : "Disabled";
    toggle.addEventListener("change", () => {
      toggle.disabled = true;
      void runtime.bridge.request("plugins", "setEnabled", { id: plugin.id, enabled: toggle.checked })
        .then(() => {
          plugin.enabled = toggle.checked;
          toggleText.textContent = plugin.enabled ? "Enabled" : "Disabled";
          restart.hidden = false;
          toggle.disabled = false;
        })
        .catch(() => {
          toggle.checked = plugin.enabled;
          toggle.disabled = false;
        });
    });
    toggleLabel.append(toggle, toggleText);
    card.append(heading, meta, description, toggleLabel);
    grid.append(card);
  }
}

function asPlugins(value: unknown): Plugin[] {
  return Array.isArray(value)
    ? value.filter((item): item is Plugin => Boolean(item && typeof item === "object" && typeof (item as Plugin).id === "string"))
    : [];
}
