// Entry point of the browser bundle (public/js/host.bundle.js). Built by `npm run build:host`.
import hosting from '../server/hosting.js';
import { mapChoices } from '../server/maps.js';

export const createBrowserHost = hosting.createBrowserHost;
export const randomRoomCode = hosting.randomRoomCode;
export { mapChoices };
