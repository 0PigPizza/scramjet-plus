const form = document.querySelector("form");
const error = document.getElementById("error");

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	error.textContent = "";
	const data = Object.fromEntries(new FormData(form));
	if (data.password !== data.confirmPassword) {
		error.textContent = "Passwords do not match.";
		return;
	}
	const response = await fetch("/api/auth/setup", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(data),
	});
	const result = await response.json();
	if (!response.ok) {
		error.textContent = result.error || "Unable to complete setup.";
		return;
	}
	location.replace("/admin");
});
