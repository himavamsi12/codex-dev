const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('test_injector.html', 'utf8');
const dom = new JSDOM(html, { runScripts: "dangerously", resources: "usable" });

dom.window.console.log = function(...args) {
  console.log('[BROWSER LOG]', ...args);
};
dom.window.console.error = function(...args) {
  console.error('[BROWSER ERROR]', ...args);
};

// Give scripts time to load and run
setTimeout(() => {
  console.log("DOM loaded. Extractor Active?", dom.window.CodexAssetExtractorActive);
}, 2000);
