const form = document.querySelector("form");
const error = document.getElementById("error");

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	error.textContent = "";
	const response = await fetch("/api/auth/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(Object.fromEntries(new FormData(form))),
	});
	const result = await response.json();
	if (!response.ok) {
		error.textContent = result.error || "Unable to sign in.";
		return;
	}
	location.replace(result.redirect || "/");
});
