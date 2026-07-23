// Portal shell: one window, five tabs, one shared "now playing" dock.
// Engines talk over DOM events: "engine-start"/"engine-stop" ({detail: name}),
// "stop-all" (dock button), "goto-view" ({detail: view name}).

const tabs = [...document.querySelectorAll("#mmTabs button")];
const views = [...document.querySelectorAll(".view")];

function go(name) {
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  views.forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  localStorage.setItem("muse.view", name);
}
tabs.forEach((t) => t.addEventListener("click", () => go(t.dataset.view)));
document.addEventListener("goto-view", (e) => go(e.detail));
go(localStorage.getItem("muse.view") || "vibe");

/* ---- dock ---- */
const ENGINE_NAMES = {
  lyria: "Lyria jam streaming",
  dreambox: "DreamBox grooving",
  song: "your song playing",
};
const dockStatus = document.getElementById("dockStatus");
const dockDot = document.getElementById("dockDot");
let liveEngine = null;

document.addEventListener("engine-start", (e) => {
  liveEngine = e.detail;
  dockStatus.textContent = `${ENGINE_NAMES[e.detail] || e.detail} — clouds flying`;
  dockDot.classList.add("live");
});
document.addEventListener("engine-stop", (e) => {
  if (liveEngine !== e.detail) return;
  liveEngine = null;
  dockStatus.textContent = "idle — pick a vibe, then make some noise";
  dockDot.classList.remove("live");
});
document.getElementById("stopAll").addEventListener("click", () =>
  document.dispatchEvent(new CustomEvent("stop-all")));
