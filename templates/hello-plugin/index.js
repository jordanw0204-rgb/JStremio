(() => {
  const manifest = {
    schemaVersion: 1,
    id: "hello-plugin",
    name: "Hello Plugin",
    version: "1.0.0",
    entry: "index.js",
    styles: "styles.css",
    enabledByDefault: false,
    loadOrder: 500,
  };

  window.JStremio.registerExtension(manifest, (runtime) => {
    const style = document.createElement("style");
    style.dataset.jstremioExtension = manifest.id;
    style.textContent = runtime.plugins.getStyles(manifest.id);
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "hello-plugin-badge";
    badge.dataset.jstremioExtension = manifest.id;
    badge.textContent = "Hello from JStremio";
    badge.addEventListener("click", () => badge.remove());
    document.head.append(style);
    document.body.append(badge);
    return () => {
      style.remove();
      badge.remove();
    };
  });
})();
