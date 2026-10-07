import {next} from '@vercel/functions';
import {protect} from './lib/access-server.mjs';
export const config={runtime:'nodejs'};
export default protect('login',next);
