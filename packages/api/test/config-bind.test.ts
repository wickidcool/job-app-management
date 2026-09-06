import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  _resetConfig,
  getConfig,
  resolveHost,
  resolvePort,
} from '../src/config.js';

/**
 * WIC-2197 — a present-but-empty `HOST` widened the bind from loopback to every
 * interface, and a present-but-empty `PORT` produced `NaN`.
 *
 * The resolver-level cases below are the ones that fail against the unfixed
 * `?? '127.0.0.1'` / `parseInt(… ?? '3000', 10)`. The `getConfig()` cases pin
 * that the resolvers are actually wired into the config object, since that is
 * what `index.ts` hands to `serve()`.
 */
describe('WIC-2197 bind-address resolution', () => {
  const saved = { PORT: process.env.PORT, HOST: process.env.HOST };

  beforeEach(() => {
    _resetConfig();
    delete process.env.PORT;
    delete process.env.HOST;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetConfig();
  });

  describe('resolveHost', () => {
    it('resolves a blank HOST to loopback, not to the wildcard address', () => {
      // The defect: `'' ?? default` is `''`, and `serve({hostname: ''})` binds `::`
      // — every interface — which is precisely where the local-dev auth bypass
      // must not be reachable from.
      expect(resolveHost('')).toBe(DEFAULT_HOST);
    });

    it('resolves an absent HOST to loopback', () => {
      expect(resolveHost(undefined)).toBe(DEFAULT_HOST);
    });

    it('passes a configured HOST through unchanged', () => {
      expect(resolveHost('0.0.0.0')).toBe('0.0.0.0');
      expect(resolveHost('::1')).toBe('::1');
      expect(resolveHost('example.internal')).toBe('example.internal');
    });

    // Regression pin: this is why the resolver is `||` and NOT `?.trim() ||`.
    // A whitespace-only HOST is truthy, so it passes through and Node rejects it
    // with ENOTFOUND — fail-CLOSED. Trimming would collapse it to '' and hand it
    // to the wildcard bind, moving the one input CI cannot catch from the safe
    // direction to the unsafe one. Do not "tidy" this into a trim.
    it('leaves a whitespace-only HOST intact so it stays fail-closed', () => {
      expect(resolveHost('   ')).toBe('   ');
      expect(resolveHost('   ')).not.toBe(DEFAULT_HOST);
      expect(resolveHost('   ')).not.toBe('');
    });
  });

  describe('resolvePort', () => {
    it('resolves a blank PORT to the default instead of NaN', () => {
      // The defect: `parseInt('', 10)` is NaN, which `serve()` rejects with
      // ERR_SOCKET_BAD_PORT — a message that never names PORT.
      expect(resolvePort('')).toBe(DEFAULT_PORT);
      expect(Number.isNaN(resolvePort(''))).toBe(false);
    });

    it('resolves a whitespace-only PORT to the default', () => {
      expect(resolvePort('   ')).toBe(DEFAULT_PORT);
    });

    it('resolves an absent PORT to the default', () => {
      expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
    });

    it('parses a configured PORT', () => {
      expect(resolvePort('8080')).toBe(8080);
      expect(resolvePort('0')).toBe(0);
      expect(resolvePort('65535')).toBe(65535);
    });

    it('throws an error naming PORT for a non-numeric value', () => {
      expect(() => resolvePort('abc')).toThrow(/PORT/);
    });

    it('throws an error naming PORT for an out-of-range value', () => {
      expect(() => resolvePort('65536')).toThrow(/PORT/);
      expect(() => resolvePort('-1')).toThrow(/PORT/);
    });

    it('throws an error naming PORT for a non-integer value', () => {
      expect(() => resolvePort('3000.5')).toThrow(/PORT/);
    });
  });

  describe('getConfig wiring', () => {
    it('uses loopback when HOST is present but empty', () => {
      process.env.HOST = '';
      expect(getConfig().host).toBe(DEFAULT_HOST);
    });

    it('uses the default port when PORT is present but empty', () => {
      process.env.PORT = '';
      expect(getConfig().port).toBe(DEFAULT_PORT);
    });

    it('still honours explicitly configured values', () => {
      process.env.HOST = '0.0.0.0';
      process.env.PORT = '8787';
      const config = getConfig();
      expect(config.host).toBe('0.0.0.0');
      expect(config.port).toBe(8787);
    });
  });
});
