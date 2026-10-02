import { App } from './app/App';
import { mountUI } from './ui/UI';

async function boot(): Promise<void> {
  const bootEl = document.getElementById('boot')!;
  const app = new App({
    app: document.getElementById('app')!,
    hud: document.getElementById('hud')!,
    ui: document.getElementById('ui')!,
  });
  mountUI(document.getElementById('ui')!, app);
  await app.start();
  bootEl.style.opacity = '0';
  setTimeout(() => bootEl.remove(), 450);
}

boot().catch((err: unknown) => {
  console.error(err);
  const bootEl = document.getElementById('boot');
  if (bootEl) {
    bootEl.classList.add('error');
    bootEl.textContent = `MACHZERO FAILED TO START\n\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  }
});
