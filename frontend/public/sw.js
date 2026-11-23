/* Kill-switch service worker.
 * Replaces the old caching worker: on install it takes over immediately, then it
 * deletes every cache, unregisters itself and reloads open tabs. It has no fetch
 * handler, so every request goes straight to the network. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      const tabs = await self.clients.matchAll({ type: "window" });
      tabs.forEach((t) => t.navigate(t.url));
    })()
  );
});
