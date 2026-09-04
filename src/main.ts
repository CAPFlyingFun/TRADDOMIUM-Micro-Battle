/** Boot only: construct the App and start it. Nothing else lives here. */
import { App } from './app/App';

const host = document.getElementById('app');
const uiLayer = document.getElementById('ui');
if (!host || !uiLayer) throw new Error('index.html must provide #app and #ui');

void new App(host, uiLayer).start();
