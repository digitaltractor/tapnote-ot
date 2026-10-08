import { render } from 'preact';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './app';
import { Store } from './data/store';
import { Vault } from './data/vault';

async function start() {
  const root = document.getElementById('app')!;
  try {
    const store = await Store.open();
    const vault = await Vault.load(store.db);
    // Ask the browser not to evict local data (Safari keeps Home Screen apps' storage).
    navigator.storage?.persist?.().catch(() => undefined);
    render(<App store={store} vault={vault} />, root);
  } catch (e) {
    root.innerHTML = `<div class="main"><h1>TapNote couldn't start</h1><p class="muted">${String((e as Error).message ?? e).replace(/[<>&]/g, '')}</p><p class="muted">Private browsing can block local storage. Open TapNote in a normal Safari window or from your Home Screen.</p></div>`;
  }
}

start();
