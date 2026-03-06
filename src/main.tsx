import "../upstream/ui/src/main.ts";

const mount = document.getElementById("root");
if (mount) {
  mount.replaceWith(document.createElement("openclaw-app"));
} else if (!document.querySelector("openclaw-app")) {
  document.body.appendChild(document.createElement("openclaw-app"));
}
