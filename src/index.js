import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import {
	addUser,
	authenticate,
	canUseService,
	consumeProxyRequest,
	createInitialAdmin,
	createSession,
	deleteUser,
	destroySession,
	expiredSessionCookie,
	getWorkspace,
	getApplicationData,
	isConfigured,
	listUsers,
	loadUsers,
	sessionCookie,
	sessionFromCookie,
	saveWorkspace,
	saveApplicationData,
	updateUser,
	updateUserSettings,
	usageFor,
} from "./auth.js";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

await loadUsers();

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (
					req.url.endsWith("/wisp/") &&
					canUseService(sessionFromCookie(req.headers.cookie)?.user)
				)
					wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

function sessionFor(request) {
	return sessionFromCookie(request.headers.cookie);
}

function requireUser(request, reply) {
	const session = sessionFor(request);
	if (!session) {
		reply.redirect("/login");
		return null;
	}
	return session;
}

function requireAdmin(request, reply) {
	const session = requireUser(request, reply);
	if (!session) return null;
	if (session.user.role !== "admin") {
		reply.code(403).send({ error: "Administrator access is required." });
		return null;
	}
	return session;
}

function requireProxyAccess(request, reply) {
	const session = requireUser(request, reply);
	if (!session) return null;
	if (!canUseService(session.user)) {
		reply
			.code(403)
			.type("text/html")
			.send("<h1>Proxy access unavailable</h1><p>Your account has expired or reached its request limit.</p>");
		return null;
	}
	return session;
}

function page(title, body, script) {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/auth.css"></head><body>${body}<script src="/${script}" defer></script></body></html>`;
}

function loginPage() {
	return page(
		"Sign in | Scramjet Plus",
		`<main class="card"><h1>Sign in</h1><p>Sign in to access the web proxy.</p><form><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Sign in</button><p id="error" class="error" aria-live="polite"></p></form></main>`,
		"login.js",
	);
}

function setupPage() {
	return page(
		"Initial setup | Scramjet Plus",
		`<main class="card"><h1>Initial setup</h1><p>Create the first administrator account for this proxy.</p><form><label>Admin username<input name="username" autocomplete="username" required pattern="[A-Za-z0-9_.-]{3,64}"></label><label>Password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label><label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8"></label><button type="submit">Create administrator</button><p id="error" class="error" aria-live="polite"></p></form></main>`,
		"setup.js",
	);
}

function adminPage() {
	return page(
		"Admin | Scramjet Plus",
		`<main class="admin-shell"><aside class="sidebar"><div><p class="eyebrow">Scramjet Plus</p><h1>Admin</h1></div><nav class="tabs" aria-label="Admin sections"><button class="tab active" data-tab="users">Users</button><button class="tab" data-tab="overview">Overview</button></nav><div class="sidebar-actions"><a class="button secondary" href="/">Open proxy</a><button id="logout" class="secondary">Sign out</button></div></aside><section class="admin-content"><section id="users-panel" class="tab-panel active"><header><p class="eyebrow">Access control</p><h2>Users</h2><p class="muted">Create, edit, and remove proxy accounts.</p></header><div class="split"><section class="panel"><h3>Add account</h3><form id="add-user"><label>Username<input name="username" autocomplete="off" required pattern="[A-Za-z0-9_.-]{3,64}"></label><label>Temporary password<input name="password" type="password" autocomplete="new-password" required minlength="8"></label><label>Role<select name="role"><option value="user">User</option><option value="admin">Administrator</option></select></label><label>Access duration in hours <span class="muted">(optional)</span><input name="accessHours" type="number" min="1" max="8760" placeholder="Unlimited"></label><label>Request limit <span class="muted">(optional)</span><input name="requestLimit" type="number" min="1" max="1000000" placeholder="Unlimited"></label><button type="submit">Add account</button><p id="error" class="error" aria-live="polite"></p></form></section><section class="panel"><h3>Accounts</h3><ul id="user-list" class="user-list"></ul></section></div></section><section id="overview-panel" class="tab-panel"><p class="eyebrow">Status</p><h2>Overview</h2><p class="muted">User access limits are applied to each proxied request. Redirect follow-up requests are counted when they are fetched through the proxy.</p></section></section></main>`,
		"admin.js",
	);
}

function settingsPage() {
	return page(
		"Settings | Scramjet Plus",
		`<main class="admin-shell"><aside class="sidebar"><div><p class="eyebrow">Scramjet Plus</p><h1>Settings</h1></div><nav class="tabs"><button class="tab active" data-tab="appearance">Appearance</button><button class="tab" data-tab="preferences">Preferences</button></nav><div class="sidebar-actions"><a class="button secondary" href="/">Open proxy</a></div></aside><section class="admin-content"><section id="appearance-panel" class="tab-panel active"><p class="eyebrow">Personalize</p><h2>Appearance</h2><p class="muted">Choose the look of your Scramjet Plus workspace.</p><form id="settings-form" class="panel settings-panel"><label>Theme<select name="theme"><option value="midnight">Midnight</option><option value="violet">Violet</option><option value="light">Light</option></select></label><button type="submit">Save theme</button><p id="error" class="error" aria-live="polite"></p></form></section><section id="preferences-panel" class="tab-panel"><p class="eyebrow">Coming soon</p><h2>Preferences</h2><p class="muted">Future personal proxy settings will appear here.</p></section></section></main>`,
		"settings.js",
	);
}

fastify.get("/", async (request, reply) => {
	if (!isConfigured()) return reply.redirect("/admin/setup");
	if (!requireProxyAccess(request, reply)) return;
	return reply.sendFile("index.html");
});

fastify.get("/index.html", async (request, reply) => {
	if (!isConfigured()) return reply.redirect("/admin/setup");
	if (!requireProxyAccess(request, reply)) return;
	return reply.sendFile("index.html");
});

fastify.get("/login", async (request, reply) => {
	if (!isConfigured()) return reply.redirect("/admin/setup");
	if (sessionFor(request)) return reply.redirect("/");
	return reply.type("text/html").send(loginPage());
});

fastify.get("/admin", async (request, reply) => {
	if (!isConfigured()) return reply.redirect("/admin/setup");
	if (!requireAdmin(request, reply)) return;
	return reply.type("text/html").send(adminPage());
});

fastify.get("/admin/setup", async (request, reply) => {
	if (isConfigured()) return reply.redirect("/admin");
	return reply.type("text/html").send(setupPage());
});

fastify.get("/settings", async (request, reply) => {
	if (!requireUser(request, reply)) return;
	return reply.type("text/html").send(settingsPage());
});

fastify.post("/api/auth/setup", async (request, reply) => {
	if (isConfigured()) return reply.code(409).send({ error: "Setup is complete." });
	try {
		const user = await createInitialAdmin(
			request.body?.username,
			request.body?.password,
		);
		const session = createSession(user);
		reply.header("set-cookie", sessionCookie(session));
		return { ok: true };
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.post("/api/auth/login", async (request, reply) => {
	if (!isConfigured()) return reply.code(409).send({ error: "Initial setup is required." });
	const user = await authenticate(request.body?.username, request.body?.password);
	if (!user) return reply.code(401).send({ error: "Invalid username or password." });
	const session = createSession(user);
	reply.header("set-cookie", sessionCookie(session));
	return { ok: true, redirect: user.role === "admin" ? "/admin" : "/" };
});

fastify.post("/api/auth/logout", async (request, reply) => {
	destroySession(request.headers.cookie);
	reply.header("set-cookie", expiredSessionCookie());
	return { ok: true };
});

fastify.get("/api/admin/users", async (request, reply) => {
	if (!requireAdmin(request, reply)) return;
	return { users: listUsers() };
});

fastify.post("/api/admin/users", async (request, reply) => {
	if (!requireAdmin(request, reply)) return;
	try {
		return {
			user: await addUser(request.body?.username, request.body?.password, {
				role: request.body?.role,
				accessHours: request.body?.accessHours,
				requestLimit: request.body?.requestLimit,
			}),
		};
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.patch("/api/admin/users/:username", async (request, reply) => {
	const session = requireAdmin(request, reply);
	if (!session) return;
	try {
		return {
			user: await updateUser(request.params.username, request.body || {}, session.user.username),
		};
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.delete("/api/admin/users/:username", async (request, reply) => {
	const session = requireAdmin(request, reply);
	if (!session) return;
	try {
		await deleteUser(request.params.username, session.user.username);
		return { ok: true };
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.get("/api/account/settings", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	return session.user.settings;
});

fastify.post("/api/account/settings", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	try {
		return await updateUserSettings(session.user.username, request.body || {});
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.get("/api/account/workspace", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	return getWorkspace(session.user.username);
});

fastify.put("/api/account/workspace", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	try {
		return await saveWorkspace(session.user.username, request.body);
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.get("/api/account/usage", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	return usageFor(session.user.username);
});

fastify.get("/api/account/application-data/:profileId", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	return {
		data: getApplicationData(session.user.username, request.params.profileId, request.query.site),
	};
});

fastify.put("/api/account/application-data/:profileId", async (request, reply) => {
	const session = requireUser(request, reply);
	if (!session) return;
	try {
		return {
			data: await saveApplicationData(
				session.user.username,
				request.params.profileId,
				request.body?.site,
				request.body?.data,
			),
		};
	} catch (error) {
		return reply.code(400).send({ error: error.message });
	}
});

fastify.post("/api/proxy/request", async (request, reply) => {
	const session = sessionFor(request);
	if (!session) return reply.code(401).send({ error: "Authentication is required." });
	const result = await consumeProxyRequest(
		session.user.username,
		request.body?.navigation === true,
	);
	if (!result.allowed) return reply.code(403).send({ error: result.error });
	return result;
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	// by default we are listening on 0.0.0.0 (every interface)
	// we just need to list a few
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
