'use strict';

/**
 * Zero-dependency static file server + shared file-response builder.
 *
 * Two consumers:
 *   - startStaticServer(): a loopback HTTP server (used for debugging, and for
 *     ACS_ORIGIN_MODE=http)
 *   - createFileResponse(): the same resolution rules, but returning a web Response
 *     for Electron's protocol.handle('app', ...)
 *
 * Serves the game out of a plain directory or out of app.asar (Electron patches fs).
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const MIME_TYPES = new Map(
  Object.entries({
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.wasm': 'application/wasm',
  })
);

const IMMUTABLE_NAME = /\.[0-9a-zA-Z_-]{8,}\.[0-9a-zA-Z]+$/;

/** Turn a request URL into a safe, root-relative POSIX path (null when hostile). */
function toSafeRelativePath(requestUrl) {
  let pathname;
  try {
    pathname = new URL(requestUrl, 'http://127.0.0.1').pathname;
  } catch (_error) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_error) {
    return null;
  }
  if (decoded.indexOf('\0') !== -1) return null;
  const normalized = path.posix.normalize(decoded).replace(/^\/+/, '');
  if (normalized.indexOf('..') === 0) return null;
  return normalized;
}

async function statOrNull(target) {
  try {
    return await fsp.stat(target);
  } catch (_error) {
    return null;
  }
}

/** Resolve a URL path to a file inside rootDir, refusing anything that escapes it. */
async function resolveFile(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, relativePath === '' ? 'index.html' : relativePath);
  if (candidate !== root && candidate.indexOf(root + path.sep) !== 0) {
    return { status: 403 };
  }
  let stats = await statOrNull(candidate);
  let file = candidate;
  if (stats && stats.isDirectory()) {
    file = path.join(candidate, 'index.html');
    stats = await statOrNull(file);
  }
  if (!stats || !stats.isFile()) return { status: 404 };
  return { status: 200, file: file, size: stats.size };
}

/**
 * Build the response for one request URL.
 * Returns a web Response, so both the HTTP server and protocol.handle share it.
 */
async function createFileResponse(rootDir, requestUrl, options) {
  const method = (options && options.method) || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' },
    });
  }

  const relativePath = toSafeRelativePath(requestUrl);
  if (relativePath === null) {
    return new Response('Bad Request', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  let resolved = await resolveFile(rootDir, relativePath);
  // Soft SPA fallback: extension-less deep links resolve to index.html.
  if (resolved.status === 404 && !path.posix.extname(relativePath)) {
    resolved = await resolveFile(rootDir, 'index.html');
  }
  if (resolved.status !== 200) {
    const label = resolved.status === 404 ? 'Not Found' : 'Forbidden';
    return new Response(label, {
      status: resolved.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const ext = path.extname(resolved.file).toLowerCase();
  const headers = {
    'Content-Type': MIME_TYPES.get(ext) || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none',
    // Hashed build output can be cached forever; HTML must never be.
    'Cache-Control': IMMUTABLE_NAME.test(path.basename(resolved.file))
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  };

  if (method === 'HEAD') {
    headers['Content-Length'] = String(resolved.size);
    return new Response(null, { status: 200, headers: headers });
  }

  const stream = fs.createReadStream(resolved.file);
  return new Response(Readable.toWeb(stream), { status: 200, headers: headers });
}

function listen(server, host, port) {
  return new Promise(function (resolve, reject) {
    const onError = function (error) {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = function () {
      server.removeListener('error', onError);
      resolve(server.address());
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: host, port: port, exclusive: true });
  });
}

/**
 * Start the loopback static server.
 * options: { rootDir, host = '127.0.0.1', preferredPort = 0, log }
 * returns: { port, origin, close() }
 */
async function startStaticServer(options) {
  const rootDir = options.rootDir;
  const host = options.host || '127.0.0.1';
  const preferredPort = options.preferredPort || 0;
  const log = options.log;

  const indexHtml = await statOrNull(path.join(rootDir, 'index.html'));
  if (!indexHtml) {
    throw new Error('Game build not found: ' + path.join(rootDir, 'index.html'));
  }

  const server = http.createServer(function (req, res) {
    createFileResponse(rootDir, req.url || '/', { method: req.method })
      .then(function (response) {
        const outHeaders = {};
        response.headers.forEach(function (value, key) {
          outHeaders[key] = value;
        });
        res.writeHead(response.status, outHeaders);
        if (!response.body) {
          res.end();
          return;
        }
        const body = Readable.fromWeb(response.body);
        body.on('error', function () {
          res.destroy();
        });
        body.pipe(res);
      })
      .catch(function (error) {
        if (log) log('[static] ' + req.url + ' failed: ' + error.message);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
      });
  });
  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10000;

  let address;
  try {
    address = await listen(server, host, preferredPort || 0);
  } catch (error) {
    if (preferredPort && error && error.code === 'EADDRINUSE') {
      if (log) log('[static] port ' + preferredPort + ' busy, falling back to an OS-assigned port');
      address = await listen(server, host, 0);
    } else {
      throw error;
    }
  }

  const port = address && typeof address === 'object' ? address.port : 0;
  if (log) log('[static] serving ' + rootDir + ' at http://' + host + ':' + port + '/');

  return {
    port: port,
    origin: 'http://' + host + ':' + port,
    close: function () {
      return new Promise(function (resolve) {
        server.close(function () {
          resolve();
        });
        if (server.closeAllConnections) server.closeAllConnections();
      });
    },
  };
}

module.exports = {
  startStaticServer: startStaticServer,
  createFileResponse: createFileResponse,
  resolveFile: resolveFile,
  toSafeRelativePath: toSafeRelativePath,
};
