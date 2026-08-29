importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

async function handleRequest(event) {
	await scramjet.loadConfig();
	if (scramjet.route(event)) {
		const access = await fetch("/api/proxy/request", {
			method: "POST",
			credentials: "same-origin",
			cache: "no-store",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ navigation: event.request.mode === "navigate" }),
		});
		if (!access.ok)
			return new Response(
				"<h1>Proxy access unavailable</h1><p>Your account has expired or reached its request limit.</p>",
				{ status: 403, headers: { "content-type": "text/html; charset=utf-8" } },
			);
		const response = await scramjet.fetch(event);
		const disposition = response.headers.get("content-disposition") || "";
		if (disposition.toLowerCase().includes("attachment")) {
			const name = disposition.match(/filename[^;=\n]*=(?:UTF-8''|[\"'])?([^;\n\"']*)/)?.[1] || "Download";
			const clients = await self.clients.matchAll({ type: "window" });
			clients.forEach((client) => client.postMessage({ type: "scramjet-download", name, url: event.request.url }));
		}
		return response;
	}
	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
