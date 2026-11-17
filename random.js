import { destinations } from "./destinations.js";

const ALLOWED_ROOTS = ["wikipedia.org", "wikimedia.org", "reddit.com"];

export function isAllowedDestination(value) {
    let url;
    try {
        url = new URL(value);
    } catch (error) {
        return false;
    }
    if (url.protocol !== "https:") {
        return false;
    }
    const host = url.hostname.toLowerCase();
    return ALLOWED_ROOTS.some(function (root) {
        return host === root || host.endsWith("." + root);
    });
}

export function chooseDestination(list, rng) {
    const allowed = [];
    for (let index = 0; index < list.length; index += 1) {
        if (isAllowedDestination(list[index])) {
            allowed.push(list[index]);
        }
    }
    if (allowed.length === 0) {
        return null;
    }
    const roll = typeof rng === "function" ? rng() : Math.random();
    const choice = Math.floor(roll * allowed.length);
    return allowed[Math.min(choice, allowed.length - 1)];
}

function startRedirect() {
    const status = document.getElementById("random-status");
    const fallback = document.getElementById("random-link");
    const choice = chooseDestination(destinations);
    const stay = new URLSearchParams(window.location.search).get("stay") === "1";

    if (!choice) {
        status.textContent = "No valid Wikipedia or Reddit destinations are configured.";
        return;
    }

    fallback.href = choice;
    fallback.textContent = choice;

    if (stay) {
        status.textContent = "Test mode. A normal visit would open this page:";
        return;
    }

    status.textContent = "Opening a page…";
    window.location.replace(choice);
}

if (document.getElementById("random-root")) {
    startRedirect();
}
