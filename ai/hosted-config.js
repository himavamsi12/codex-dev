// Hosted Codex AI: the free tier with a daily limit, served by the backend in
// backend/ (deploy it to Vercel, see backend/README.md). The extension never
// holds an AI key for it; the server does.
//
// Set `url` to your deployed backend, with no trailing slash, for example
// 'https://codex-dev-ai.vercel.app'. While it is empty the hosted option is
// hidden and the extension works only with the user's own key, as before.
self.CODEX_HOSTED = { url: '' };
