// Comprehensive stealth script for Playwright
// Handles: webdriver, plugins, mimeTypes, WebGL, platform, chrome, permissions

const stealthInitScript = `
// 1. navigator.webdriver
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// 2. window.chrome
if (!window.chrome) {
  window.chrome = {};
}
window.chrome.runtime = { id: 'cpmheoeobamkdpnoeebmjonebmgobkgh' };
window.chrome.loadTimes = () => ({});
window.chrome.csi = () => ({});
window.chrome.app = {
  isInstalled: false,
  InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
  RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
};

// 3. navigator.plugins - proper PluginArray
(function() {
  const rawPlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1, 0: { type: 'application/pdf', suffixes: 'pdf', description: '' } },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2, 0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' }, 1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' } }
  ];
  const fakeMime = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' };
  const fakeMime2 = { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' };

  Object.defineProperty(navigator, 'plugins', {
    get: () => Object.setPrototypeOf([
      { name: rawPlugins[0].name, filename: rawPlugins[0].filename, description: rawPlugins[0].description, length: 1, item: () => null, namedItem: () => null },
      { name: rawPlugins[1].name, filename: rawPlugins[1].filename, description: rawPlugins[1].description, length: 1, 0: fakeMime, item: function(i) { return i === 0 ? fakeMime : null; }, namedItem: function() { return fakeMime; } },
      { name: rawPlugins[2].name, filename: rawPlugins[2].filename, description: rawPlugins[2].description, length: 2, 0: fakeMime2, 1: fakeMime, item: function(i) { return [fakeMime2, fakeMime][i] || null; }, namedItem: function() { return null; } },
    ], PluginArray.prototype);
  });

  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => Object.setPrototypeOf([fakeMime, fakeMime2], MimeTypeArray.prototype)
  });
})();

// 4. navigator.platform - match Windows UA
Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

// 5. navigator.hardwareConcurrency and deviceMemory
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

// 6. WebGL fingerprint - hide SwiftShader
(function() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(...args) {
    const context = originalGetContext.apply(this, args);
    if (context && (args[0] === 'webgl' || args[0] === 'webgl2' || args[0] === 'experimental-webgl')) {
      const originalGetParameter = context.getParameter.bind(context);
      const getParameterProxyHandler = {
        apply(target, thisArg, args) {
          const parameter = args[0];
          if (parameter === 37445) return 'Google Inc. (Intel)';
          if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B), Direct3D11 vs_5_0 ps_5_0, D3D11)';
          return target(thisArg, args);
        }
      };
      context.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);
    }
    return context;
  };
})();

// 7. Navigator permissions
const originalQuery = window.navigator.permissions?.query;
if (originalQuery) {
  navigator.permissions.query = new Proxy(originalQuery, {
    apply(target, thisArg, args) {
      return Promise.resolve({ state: 'prompt', onchange: null });
    }
  });
}

// 8. screen colorDepth / pixelDepth (already correct but ensure)
Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

// 9. notification permission
if (typeof Notification !== 'undefined') {
  Object.defineProperty(Notification, 'permission', { get: () => 'default' });
}

// 10. navigator.userAgentData — spoof brands to hide HeadlessChrome
(function() {
  const brands = [
    { brand: 'Google Chrome', version: '131' },
    { brand: 'Chromium', version: '131' },
    { brand: 'Not=A?Brand', version: '24' },
  ];
  const uaData = {
    brands,
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: function(hints) {
      const result = {
        brands,
        mobile: false,
        platform: 'Windows',
        platformVersion: '13.0.0',
        architecture: 'x86',
        bitness: '64',
        fullVersionList: [
          { brand: 'Google Chrome', version: '131.0.6778.205' },
          { brand: 'Chromium', version: '131.0.6778.205' },
          { brand: 'Not=A?Brand', version: '24.0.0.0' },
        ],
        uaFullVersion: '131.0.6778.205',
        wow64: false,
        model: '',
      };
      if (hints) {
        const filtered = {};
        for (const hint of hints) {
          if (result[hint] !== undefined) filtered[hint] = result[hint];
        }
        return Promise.resolve(filtered);
      }
      return Promise.resolve(result);
    },
    toJSON: function() {
      return { brands, mobile: false, platform: 'Windows' };
    },
  };
  Object.defineProperty(navigator, 'userAgentData', {
    get: () => uaData,
    configurable: true,
    enumerable: true,
  });
})();

// 11. window outer/inner dimensions (match viewport)
Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
Object.defineProperty(window, 'outerHeight', { get: () => 1080 });

// 12. navigator.maxTouchPoints
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
`;

export default stealthInitScript;
