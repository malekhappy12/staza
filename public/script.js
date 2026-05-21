document.addEventListener("DOMContentLoaded", function () {
    const adminPanelLink = document.getElementById("admin-panel-link");
    if (adminPanelLink) {
        adminPanelLink.addEventListener("click", function (event) {
            event.preventDefault();

            fetch("/check-admin")
                .then(response => response.json())
                .then(data => {
                    if (data.admin) {
                        window.location.href = "/admin.html";
                    } else {
                        alert("You're not an admin!");
                    }
                })
                .catch(error => {
                    console.error("Error checking admin status:", error);
                    alert("Error checking admin status. Try again later.");
                });
        });
    }
});

document.addEventListener("DOMContentLoaded", function () {
    fetch('/get-user-data')
        .then(response => response.json())
        .then(data => {
            console.log("User Data:", data); // Debugging log
            if (data.username) {
                document.getElementById('username').textContent = data.username;
                document.getElementById('balance').textContent = "$" + data.balance.toFixed(2);
            } else {
                window.location.href = '/login.html'; // Redirect if not logged in
            }
        })
        .catch(error => console.error("Error fetching user data:", error));
});