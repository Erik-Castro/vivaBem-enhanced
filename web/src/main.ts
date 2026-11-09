import { mount } from "svelte";
import { registerSW } from "virtual:pwa-register";
import App from "./App.svelte";
import "./app.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Elemento #app não encontrado");
}

// O service worker só é útil no build. Em dev o Vite serve tudo direto.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

const app = mount(App, { target });

export default app;
