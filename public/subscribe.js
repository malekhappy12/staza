// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then(() => {
    console.log("✅ Service Worker registered");
    initPush();
  });
}

async function initPush() {
  // 1. Ask for notification permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.log("❌ Notifications blocked by user");
    return;
  }

  // 2. Get public VAPID key from server
  const res = await fetch("/vapid-public-key");
  const { key } = await res.json();

  const applicationServerKey = urlBase64ToUint8Array(key);

  // 3. Subscribe browser to push
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey
  });

  console.log("📡 New subscription:", subscription);

  // 4. Send subscription to server to save in DB
  await fetch("/save-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription)
  });

  console.log("✅ Subscription sent to backend");
}

// helper
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}