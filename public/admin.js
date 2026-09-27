const error = document.getElementById("error");
const userList = document.getElementById("user-list");

function showTab(name) {
	document
		.querySelectorAll(".tab")
		.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
	document
		.querySelectorAll(".tab-panel")
		.forEach((panel) =>
			panel.classList.toggle("active", panel.id === `${name}-panel`)
		);
}

document
	.querySelectorAll(".tab")
	.forEach((tab) =>
		tab.addEventListener("click", () => showTab(tab.dataset.tab))
	);

async function loadUsers() {
	const response = await fetch("/api/admin/users");
	const result = await response.json();
	if (!response.ok) throw new Error(result.error || "Unable to load users.");
	userList.replaceChildren(
		...result.users.map((user) => {
			const item = document.createElement("li");
			const name = document.createElement("strong");
			name.textContent = user.username;
			const details = document.createElement("span");
			details.className = "account-meta";
			const requests =
				user.requestLimit === null
					? `${user.requestsUsed} requests used`
					: `${user.requestsUsed} / ${user.requestLimit} requests`;
			const expires = user.accessExpiresAt
				? `expires ${new Date(user.accessExpiresAt).toLocaleString()}`
				: "no expiry";
			details.textContent = `${user.role} · ${requests} · ${expires}`;
			const actions = document.createElement("div");
			actions.className = "account-actions";
			const edit = document.createElement("button");
			edit.className = "secondary compact";
			edit.textContent = "Edit";
			edit.addEventListener("click", () => editUser(user));
			const remove = document.createElement("button");
			remove.className = "secondary compact danger";
			remove.textContent = "Delete";
			remove.addEventListener("click", () => deleteUser(user));
			actions.append(edit, remove);
			item.append(name, details, actions);
			return item;
		})
	);
}

async function editUser(user) {
	const role = prompt("Role: user or admin", user.role);
	if (role === null) return;
	const requestLimit = prompt(
		"Request limit (leave blank for unlimited)",
		user.requestLimit ?? ""
	);
	if (requestLimit === null) return;
	const accessExpiresAt = prompt(
		"Expiry (ISO date/time; leave blank for no expiry)",
		user.accessExpiresAt || ""
	);
	if (accessExpiresAt === null) return;
	const response = await fetch(
		`/api/admin/users/${encodeURIComponent(user.username)}`,
		{
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ role, requestLimit, accessExpiresAt }),
		}
	);
	const result = await response.json();
	if (!response.ok) {
		error.textContent = result.error || "Unable to update user.";
		return;
	}
	await loadUsers();
}

async function deleteUser(user) {
	if (!confirm(`Delete ${user.username}? This cannot be undone.`)) return;
	const response = await fetch(
		`/api/admin/users/${encodeURIComponent(user.username)}`,
		{
			method: "DELETE",
		}
	);
	const result = await response.json();
	if (!response.ok) {
		error.textContent = result.error || "Unable to delete user.";
		return;
	}
	await loadUsers();
}

document
	.getElementById("add-user")
	.addEventListener("submit", async (event) => {
		event.preventDefault();
		error.textContent = "";
		const form = event.currentTarget;
		const response = await fetch("/api/admin/users", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(Object.fromEntries(new FormData(form))),
		});
		const result = await response.json();
		if (!response.ok) {
			error.textContent = result.error || "Unable to add user.";
			return;
		}
		form.reset();
		await loadUsers();
	});

document.getElementById("logout").addEventListener("click", async () => {
	await fetch("/api/auth/logout", { method: "POST" });
	location.replace("/login");
});

loadUsers().catch((err) => (error.textContent = err.message));
