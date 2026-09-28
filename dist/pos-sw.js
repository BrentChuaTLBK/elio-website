// Installation support only. Sales, private data and credentials are never
// cached or queued offline; every inventory and payment action reaches Elio.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
