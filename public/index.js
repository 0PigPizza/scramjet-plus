const $ = (selector) => document.querySelector(selector);
const id = () => crypto.randomUUID();
const form = $("#sj-form");
const address = $("#sj-address");
const error = $("#sj-error");
const errorCode = $("#sj-error-code");
const host = $("#frame-host");
const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});
scramjet.init();
const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
let frame;
let workspace;
let currentSite;
let activeView = "home";
let saveTimer;

const profile = () =>
	workspace.profiles.find((item) => item.id === workspace.activeProfileId) ||
	workspace.profiles[0];
const short = (value, length = 28) =>
	value.length > length ? `${value.slice(0, length)}…` : value;

async function request(path, options) {
	const response = await fetch(path, options);
	const body = await response.json();
	if (!response.ok) throw new Error(body.error || "Request failed.");
	return body;
}

function scheduleSave() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(
		() =>
			request("/api/account/workspace", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(workspace),
			}).catch((err) => (error.textContent = err.message)),
		400
	);
}

function renderProfiles() {
	const picker = $("#profile-picker");
	picker.replaceChildren(
		...workspace.profiles.map(
			(item) =>
				new Option(
					item.name,
					item.id,
					item.id === profile().id,
					item.id === profile().id
				)
		)
	);
}

function renderLists() {
	const current = profile();
	const list = (target, items, label) => {
		const node = $(target);
		node.replaceChildren(
			...items.map((item) => {
				const button = document.createElement("button");
				button.textContent = label(item);
				button.onclick = () => navigate(item.url);
				return button;
			})
		);
	};
	list("#bookmark-list", current.bookmarks, (item) => `★ ${item.title}`);
	list(
		"#history-list",
		current.history,
		(item) => `${item.title} · ${new Date(item.at).toLocaleString()}`
	);
	list(
		"#download-list",
		current.downloads,
		(item) => `${item.name} · ${item.url}`
	);
	$("#recent").replaceChildren(
		...current.history.slice(0, 3).map((item) => {
			const button = document.createElement("button");
			button.textContent = short(item.title, 20);
			button.onclick = () => navigate(item.url);
			return button;
		})
	);
	$("#quick-links").replaceChildren(
		...current.bookmarks.slice(0, 3).map((item) => {
			const button = document.createElement("button");
			button.textContent = short(item.title, 20);
			button.onclick = () => navigate(item.url);
			return button;
		})
	);
}

function render() {
	renderProfiles();
	renderLists();
}

function show(view) {
	activeView = view;
	document
		.querySelectorAll(".view")
		.forEach((node) => node.classList.toggle("active", node.id === view));
	document
		.querySelectorAll(".side-nav [data-view]")
		.forEach((node) =>
			node.classList.toggle("active", node.dataset.view === view)
		);
	if (view !== "home") host.classList.remove("active");
}

async function ensureFrame() {
	if (frame) return frame;
	await registerSW();
	const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/wisp/`;
	if ((await connection.getTransport()) !== "/libcurl/index.mjs")
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	host.appendChild(frame.frame);
	return frame;
}

async function navigate(raw) {
	const url = search(raw, "https://www.google.com/search?q=%s");
	const site = new URL(url).origin;
	currentSite = { title: new URL(url).hostname || url, url, site };
	const existingData = profile().siteData[site] || { visits: 0 };
	profile().siteData[site] = {
		...existingData,
		visits: existingData.visits + 1,
		lastVisited: new Date().toISOString(),
	};
	profile().history = [
		{ id: id(), title: currentSite.title, url, at: new Date().toISOString() },
		...profile().history.filter((item) => item.url !== url),
	].slice(0, 250);
	render();
	scheduleSave();
	show("home");
	host.classList.add("active");
	request(`/api/account/application-data/${encodeURIComponent(profile().id)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ site, data: profile().siteData[site] }),
	}).catch(() => {});
	try {
		const proxyFrame = await ensureFrame();
		proxyFrame.go(url);
		setTimeout(
			() =>
				proxyFrame.frame.contentWindow?.postMessage(
					{
						type: "scramjet-plus:application-data",
						site,
						data: profile().siteData[site],
					},
					"*"
				),
			250
		);
	} catch (err) {
		error.textContent = "Unable to start proxy.";
		errorCode.textContent = err.toString();
	}
}

function openPalette() {
	$("#palette").showModal();
	$("#palette-input").value = "";
	renderPalette("");
	$("#palette-input").focus();
}
function renderPalette(query) {
	const lower = query.toLowerCase();
	const results = [
		{
			label: "Go home",
			action: () => {
				host.classList.remove("active");
				show("home");
			},
		},
		{ label: "Add current page to bookmarks", action: addBookmark },
		{ label: "Open settings", action: () => (location.href = "/settings") },
		...profile().bookmarks.map((item) => ({
			label: `Bookmark: ${item.title}`,
			action: () => navigate(item.url),
		})),
		...profile()
			.history.slice(0, 30)
			.map((item) => ({
				label: `History: ${item.title}`,
				action: () => navigate(item.url),
			})),
	].filter((item) => item.label.toLowerCase().includes(lower));
	$("#palette-results").replaceChildren(
		...results.slice(0, 12).map((item) => {
			const button = document.createElement("button");
			button.textContent = item.label;
			button.onclick = () => {
				$("#palette").close();
				item.action();
			};
			return button;
		})
	);
}
function addBookmark() {
	if (!currentSite?.url) return;
	if (!profile().bookmarks.some((item) => item.url === currentSite.url))
		profile().bookmarks.unshift({
			id: id(),
			title: currentSite.title,
			url: currentSite.url,
			collection: "General",
		});
	renderLists();
	scheduleSave();
}

async function init() {
	const [settings, savedWorkspace, usage] = await Promise.all([
		request("/api/account/settings"),
		request("/api/account/workspace"),
		request("/api/account/usage"),
	]);
	document.documentElement.dataset.theme = settings.theme;
	workspace = savedWorkspace;
	$("#usage").textContent =
		usage.requestLimit === null
			? `${usage.requestsUsed} navigations`
			: `${usage.requestsUsed} / ${usage.requestLimit} navigations`;
	$("#expiry").textContent = usage.accessExpiresAt
		? `Access expires ${new Date(usage.accessExpiresAt).toLocaleString()}`
		: "No access expiry";
	render();
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	navigate(address.value);
});
$("#add-profile").onclick = () => {
	const name = prompt("Profile name");
	if (!name?.trim()) return;
	const item = {
		id: id(),
		name: name.trim().slice(0, 40),
		bookmarks: [],
		history: [],
		downloads: [],
		siteData: {},
	};
	workspace.profiles.push(item);
	workspace.activeProfileId = item.id;
	currentSite = undefined;
	render();
	scheduleSave();
	show("home");
};
$("#profile-picker").onchange = (event) => {
	workspace.activeProfileId = event.target.value;
	currentSite = undefined;
	render();
	scheduleSave();
	host.classList.remove("active");
	show("home");
};
$("#command").onclick = openPalette;
$("#palette-input").oninput = (event) => renderPalette(event.target.value);
document.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
		event.preventDefault();
		openPalette();
	}
	if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
		event.preventDefault();
		addBookmark();
	}
});
document
	.querySelectorAll(".side-nav [data-view]")
	.forEach((button) => (button.onclick = () => show(button.dataset.view)));
navigator.serviceWorker?.addEventListener("message", (event) => {
	if (event.data?.type !== "scramjet-download") return;
	profile().downloads.unshift({
		id: id(),
		name: event.data.name,
		url: event.data.url,
		at: new Date().toISOString(),
		state: "Complete",
	});
	profile().downloads = profile().downloads.slice(0, 100);
	renderLists();
	scheduleSave();
});
window.addEventListener("message", (event) => {
	if (
		event.source !== frame?.frame.contentWindow ||
		event.data?.type !== "scramjet-plus:save-application-data" ||
		!currentSite
	)
		return;
	profile().siteData[currentSite.site] = event.data.data;
	scheduleSave();
	request(`/api/account/application-data/${encodeURIComponent(profile().id)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ site: currentSite.site, data: event.data.data }),
	}).catch(() => {});
});
init().catch((err) => {
	error.textContent = "Unable to load workspace.";
	errorCode.textContent = err.toString();
});
