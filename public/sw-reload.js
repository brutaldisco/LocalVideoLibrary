// After an update, reopen open windows. A stale precache can serve HTML
// in place of the app script, so the page never runs the reload listener.
let reloadClientsOnActivate = false;

self.addEventListener("install", () => {
  reloadClientsOnActivate = Boolean(self.registration.active);
});

self.addEventListener("activate", (event) => {
  if (!reloadClientsOnActivate) {
    return;
  }
  event.waitUntil(
    self.clients
      .claim()
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((clients) =>
        Promise.all(
          clients.map((client) => {
            if (!client.url || typeof client.navigate !== "function") {
              return undefined;
            }
            return client.navigate(client.url).catch(() => undefined);
          }),
        ),
      ),
  );
});
