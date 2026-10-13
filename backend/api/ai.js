import { send } from '../lib/handler.js';
import { runtime } from '../lib/runtime.js';

export default async function handler(req, res) {
    send(res, await runtime().handleAi(req));
}
