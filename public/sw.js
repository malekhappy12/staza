self.addEventListener('push', (event) => {
  let data = {};
  
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '💸 New Transfer!';
  const options = getNotificationOptions(data);

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TEST_NOTIFICATION') {
    const title = event.data.title || 'Test Notification';
    const options = getNotificationOptions(event.data);
    self.registration.showNotification(title, options);
  }
});

function getNotificationOptions(data = {}) {
  return {
    body: data.body || 'You received money.',
    icon: data.icon || '/icon.png',
    badge: data.badge || '/badge.png',
    vibrate: data.vibrate || [200, 100, 200],
    data: data.data || { url: '/' },
    actions: data.actions || [{ action: 'open', title: 'Open' }]
  };
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const fullUrl = new URL(url, self.registration.scope).href;

      for (const client of windowClients) {
        if (client.url === fullUrl || client.url.includes(url)) {
          return client.focus();
        }
      }

      if (clients.openWindow) return clients.openWindow(fullUrl);
    })
  );
});