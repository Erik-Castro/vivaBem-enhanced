import { mount } from "svelte";
import { registerSW } from "virtual:pwa-register";
import App from "./App.svelte";
import { push } from "./lib/push.svelte";
import "./app.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Elemento #app não encontrado");
}

// O service worker só é útil no build. Em dev o Vite serve tudo direto.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

// O navegador pode trocar a assinatura push sozinho. Só a página consegue
// renovar CSRF e reenviar o vínculo ao servidor, então o service worker avisa.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: string } | null;
    if (data?.type === "push-subscription-change") void push.handleSubscriptionChange();
  });
}

const app = mount(App, { target });

export default app;
