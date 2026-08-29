const settingsForm = document.getElementById("settings-form");
const settingsError = document.getElementById("error");

function showTab(name) {
	document.querySelectorAll(".tab").forEach((tab) =>
		tab.classList.toggle("active", tab.dataset.tab === name),
	);
	document.querySelectorAll(".tab-panel").forEach((panel) =>
		panel.classList.toggle("active", panel.id === `${name}-panel`),
	);
}

document.querySelectorAll(".tab").forEach((tab) =>
	tab.addEventListener("click", () => showTab(tab.dataset.tab)),
);

fetch("/api/account/settings")
	.then((response) => response.json())
	.then((settings) => (settingsForm.theme.value = settings.theme))
	.catch(() => (settingsError.textContent = "Unable to load settings."));

settingsForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	settingsError.textContent = "";
	const response = await fetch("/api/account/settings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(Object.fromEntries(new FormData(settingsForm))),
	});
	const result = await response.json();
	if (!response.ok) {
		settingsError.textContent = result.error || "Unable to save settings.";
		return;
	}
	document.documentElement.dataset.theme = result.theme;
	settingsError.textContent = "Saved.";
});
