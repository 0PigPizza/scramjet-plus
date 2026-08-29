import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const dataFile = process.env.AUTH_DATA_FILE ||
	fileURLToPath(new URL("../data/users.json", import.meta.url));
const sessionLifetimeMs = 1000 * 60 * 60 * 12;
const themes = new Set(["midnight", "violet", "light"]);

let users = [];
let writeQueue = Promise.resolve();
const sessions = new Map();

function validateUsername(username) {
	return typeof username === "string" && /^[a-zA-Z0-9_.-]{3,64}$/.test(username);
}

function validatePassword(password) {
	return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

function normalizeUsername(username) {
	return username.trim().toLowerCase();
}

function defaultWorkspace() {
	const profileId = randomBytes(8).toString("hex");
	return {
		activeProfileId: profileId,
		profiles: [
			{
				id: profileId,
				name: "Personal",
				bookmarks: [],
				history: [],
				downloads: [],
				siteData: {},
			},
		],
	};
}

function workspaceFor(user) {
	if (!user.workspace || !Array.isArray(user.workspace.profiles)) {
		user.workspace = defaultWorkspace();
		return user.workspace;
	}
	for (const profile of user.workspace.profiles) {
		profile.bookmarks ||= [];
		profile.history ||= [];
		profile.downloads ||= [];
		profile.siteData ||= {};
	}
	return user.workspace;
}

function settingsFor({ accessHours, requestLimit } = {}) {
	let accessExpiresAt = null;
	let normalizedRequestLimit = null;

	if (accessHours !== undefined && accessHours !== "") {
		const hours = Number(accessHours);
		if (!Number.isInteger(hours) || hours < 1 || hours > 8760)
			throw new Error("Access duration must be a whole number between 1 and 8760 hours.");
		accessExpiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
	}

	if (requestLimit !== undefined && requestLimit !== "") {
		const limit = Number(requestLimit);
		if (!Number.isInteger(limit) || limit < 1 || limit > 1000000)
			throw new Error("Request limit must be a whole number between 1 and 1,000,000.");
		normalizedRequestLimit = limit;
	}

	return { accessExpiresAt, requestLimit: normalizedRequestLimit };
}

async function saveUsers() {
	const tempFile = `${dataFile}.tmp`;
	await mkdir(dirname(dataFile), { recursive: true });
	await writeFile(tempFile, `${JSON.stringify({ users }, null, 2)}\n`, {
		mode: 0o600,
	});
	await rename(tempFile, dataFile);
	await chmod(dataFile, 0o600);
}

async function persist(task) {
	const result = writeQueue.then(task, task);
	writeQueue = result.catch(() => {});
	return result;
}

async function createUser(username, password, role, settings, initialSetup = false) {
	if (!validateUsername(username))
		throw new Error("Username must be 3–64 characters: letters, numbers, ., _, or -.");
	if (!validatePassword(password))
		throw new Error("Password must be between 8 and 128 characters.");

	const normalized = normalizeUsername(username);
	const access = settingsFor(settings);
	const salt = randomBytes(16).toString("base64url");
	const passwordHash = (await scrypt(password, salt, 64)).toString("base64url");

	return persist(async () => {
		if (initialSetup && isConfigured())
			throw new Error("Initial setup has already been completed.");
		if (users.some((user) => user.username === normalized))
			throw new Error("That username is already in use.");

		const user = {
			username: normalized,
			passwordHash,
			salt,
			role,
			createdAt: new Date().toISOString(),
			...access,
			requestsUsed: 0,
			settings: { theme: "midnight" },
			workspace: defaultWorkspace(),
		};
		users.push(user);
		await saveUsers();
		return publicUser(user);
	});
}

function publicUser(user) {
	return {
		username: user.username,
		role: user.role,
		createdAt: user.createdAt,
		accessExpiresAt: user.accessExpiresAt || null,
		requestLimit: Number.isInteger(user.requestLimit) ? user.requestLimit : null,
		requestsUsed: Number.isInteger(user.requestsUsed) ? user.requestsUsed : 0,
		settings: { theme: themes.has(user.settings?.theme) ? user.settings.theme : "midnight" },
	};
}

export async function loadUsers() {
	try {
		const stored = JSON.parse(await readFile(dataFile, "utf8"));
		if (!Array.isArray(stored.users)) throw new Error("Invalid users file");
		users = stored.users.filter(
			(user) =>
				typeof user?.username === "string" &&
				typeof user?.passwordHash === "string" &&
				typeof user?.salt === "string" &&
				["admin", "user"].includes(user?.role),
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		users = [];
	}
}

export function isConfigured() {
	return users.some((user) => user.role === "admin");
}

export async function createInitialAdmin(username, password) {
	if (isConfigured()) throw new Error("Initial setup has already been completed.");
	return createUser(username, password, "admin", undefined, true);
}

export async function addUser(username, password, settings) {
	const role = settings?.role === "admin" ? "admin" : "user";
	return createUser(username, password, role, settings);
}

export async function authenticate(username, password) {
	if (typeof username !== "string" || typeof password !== "string") return null;
	const user = users.find((candidate) => candidate.username === normalizeUsername(username));
	if (!user) return null;

	const suppliedHash = Buffer.from(await scrypt(password, user.salt, 64));
	const expectedHash = Buffer.from(user.passwordHash, "base64url");
	if (
		suppliedHash.length !== expectedHash.length ||
		!timingSafeEqual(suppliedHash, expectedHash)
	)
		return null;

	return publicUser(user);
}

export function listUsers() {
	return users.map(publicUser);
}

export async function updateUser(username, updates, actorUsername) {
	return persist(async () => {
		const user = users.find((candidate) => candidate.username === username);
		if (!user) throw new Error("User not found.");
		const nextRole = updates.role || user.role;
		if (!["admin", "user"].includes(nextRole)) throw new Error("Invalid account role.");
		const adminCount = users.filter((candidate) => candidate.role === "admin").length;
		if (user.username === actorUsername && nextRole !== "admin")
			throw new Error("You cannot remove your own administrator access.");
		if (user.role === "admin" && nextRole !== "admin" && adminCount <= 1)
			throw new Error("At least one administrator must remain.");

		if (updates.requestLimit !== undefined) {
			if (updates.requestLimit === "" || updates.requestLimit === null) user.requestLimit = null;
			else {
				const limit = Number(updates.requestLimit);
				if (!Number.isInteger(limit) || limit < 1 || limit > 1000000)
					throw new Error("Request limit must be a whole number between 1 and 1,000,000.");
				user.requestLimit = limit;
			}
		}
		if (updates.accessExpiresAt !== undefined) {
			if (updates.accessExpiresAt === "" || updates.accessExpiresAt === null)
				user.accessExpiresAt = null;
			else {
				const time = Date.parse(updates.accessExpiresAt);
				if (Number.isNaN(time) || time <= Date.now())
					throw new Error("Expiry must be a valid future date and time.");
				user.accessExpiresAt = new Date(time).toISOString();
			}
		}
		if (updates.resetUsage) user.requestsUsed = 0;
		if (updates.password) {
			if (!validatePassword(updates.password))
				throw new Error("Password must be between 8 and 128 characters.");
			user.salt = randomBytes(16).toString("base64url");
			user.passwordHash = (await scrypt(updates.password, user.salt, 64)).toString("base64url");
		}
		user.role = nextRole;
		await saveUsers();
		return publicUser(user);
	});
}

export async function deleteUser(username, actorUsername) {
	return persist(async () => {
		const index = users.findIndex((user) => user.username === username);
		if (index === -1) throw new Error("User not found.");
		const user = users[index];
		if (user.username === actorUsername) throw new Error("You cannot delete your own account.");
		if (user.role === "admin" && users.filter((candidate) => candidate.role === "admin").length <= 1)
			throw new Error("At least one administrator must remain.");
		users.splice(index, 1);
		await saveUsers();
	});
}

export async function updateUserSettings(username, updates) {
	if (!themes.has(updates.theme)) throw new Error("Invalid theme.");
	return persist(async () => {
		const user = users.find((candidate) => candidate.username === username);
		if (!user) throw new Error("User not found.");
		user.settings = { ...user.settings, theme: updates.theme };
		await saveUsers();
		return publicUser(user).settings;
	});
}

export function getWorkspace(username) {
	const user = users.find((candidate) => candidate.username === username);
	if (!user) return null;
	return structuredClone(workspaceFor(user));
}

export async function saveWorkspace(username, workspace) {
	if (!workspace || !Array.isArray(workspace.profiles) || workspace.profiles.length < 1)
		throw new Error("Invalid workspace.");
	if (workspace.profiles.length > 12) throw new Error("A workspace can have up to 12 profiles.");
	return persist(async () => {
		const user = users.find((candidate) => candidate.username === username);
		if (!user) throw new Error("User not found.");
		user.workspace = structuredClone(workspace);
		workspaceFor(user);
		await saveUsers();
		return structuredClone(user.workspace);
	});
}

export function usageFor(username) {
	const user = users.find((candidate) => candidate.username === username);
	if (!user) return null;
	const account = publicUser(user);
	return {
		requestsUsed: account.requestsUsed,
		requestLimit: account.requestLimit,
		accessExpiresAt: account.accessExpiresAt,
	};
}

export function getApplicationData(username, profileId, site) {
	const user = users.find((candidate) => candidate.username === username);
	const profile = user && workspaceFor(user).profiles.find((item) => item.id === profileId);
	return profile?.siteData?.[site] || null;
}

export async function saveApplicationData(username, profileId, site, data) {
	if (typeof site !== "string" || site.length > 300) throw new Error("Invalid site key.");
	if (JSON.stringify(data).length > 250000) throw new Error("Application data is too large.");
	return persist(async () => {
		const user = users.find((candidate) => candidate.username === username);
		const profile = user && workspaceFor(user).profiles.find((item) => item.id === profileId);
		if (!profile) throw new Error("Profile not found.");
		profile.siteData[site] = structuredClone(data);
		await saveUsers();
		return profile.siteData[site];
	});
}

export function canUseService(user) {
	return (
		user &&
		(!user.accessExpiresAt || Date.parse(user.accessExpiresAt) > Date.now()) &&
		(user.requestLimit === null || user.requestsUsed < user.requestLimit)
	);
}

export async function consumeProxyRequest(username, countRequest = true) {
	return persist(async () => {
		const user = users.find((candidate) => candidate.username === username);
		if (!user) return { allowed: false, error: "Account not found." };

		const account = publicUser(user);
		if (!canUseService(account))
			return { allowed: false, error: "Your proxy access limit has been reached." };

		if (!countRequest)
			return {
				allowed: true,
				requestsUsed: account.requestsUsed,
				requestLimit: account.requestLimit,
			};

		user.requestsUsed = account.requestsUsed + 1;
		await saveUsers();
		return {
			allowed: true,
			requestsUsed: user.requestsUsed,
			requestLimit: account.requestLimit,
		};
	});
}

export function createSession(user) {
	const token = randomBytes(32).toString("base64url");
	const session = {
		token,
		user,
		expiresAt: Date.now() + sessionLifetimeMs,
	};
	sessions.set(token, session);
	return session;
}

export function sessionFromCookie(cookieHeader = "") {
	const token = cookieHeader
		.split(";")
		.map((part) => part.trim().split("="))
		.find(([name]) => name === "sj_session")?.[1];
	if (!token) return null;

	const session = sessions.get(token);
	if (!session || session.expiresAt <= Date.now()) {
		sessions.delete(token);
		return null;
	}
	const user = users.find((candidate) => candidate.username === session.user.username);
	if (!user) {
		sessions.delete(token);
		return null;
	}
	session.user = publicUser(user);
	return session;
}

export function destroySession(cookieHeader) {
	const session = sessionFromCookie(cookieHeader);
	if (session) sessions.delete(session.token);
}

export function sessionCookie(session) {
	return `sj_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`;
}

export function expiredSessionCookie() {
	return "sj_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}
