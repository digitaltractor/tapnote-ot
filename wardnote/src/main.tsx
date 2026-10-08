import { render } from 'preact';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { App } from './app';
import { Store } from './data/store';
import { sampleWard } from './core/sample';
import { todayKey } from './core/dates';
import { getPrefs } from './data/prefs';

async function start() {
  const root = document.getElementById('app')!;
  try {
    const store = await Store.open();
    if (!(await store.isSeeded())) await store.replaceAll(sampleWard(todayKey(), () => crypto.randomUUID()));
    await store.expireDrafts(getPrefs().draftDays);
    navigator.storage?.persist?.().catch(() => undefined);
    render(<App store={store} />, root);
  } catch (e) {
    root.innerHTML = `<div class="main"><h1>WardNote couldn't start</h1><p class="muted">${String((e as Error).message ?? e).replace(/[<>&]/g, '')}</p><p class="muted">Private browsing can block local storage. Open it in a normal browser window.</p></div>`;
  }
}

start();
