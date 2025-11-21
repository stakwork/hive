import { describe, it, expect } from 'vitest';
import { isPrivateIP, validateExternalUrl, isAllowedDomain } from '@/lib/utils/url-validator';

describe('url-validator', () => {
  describe('isPrivateIP', () => {
    it('should block localhost', () => {
      expect(isPrivateIP('http://localhost:3000')).toBe(true);
      expect(isPrivateIP('http://localhost')).toBe(true);
    });

    it('should block 127.x.x.x addresses', () => {
      expect(isPrivateIP('http://127.0.0.1')).toBe(true);
      expect(isPrivateIP('http://127.0.0.1:8080')).toBe(true);
      expect(isPrivateIP('http://127.255.255.255')).toBe(true);
    });

    it('should block 10.x.x.x addresses', () => {
      expect(isPrivateIP('http://10.0.0.1')).toBe(true);
      expect(isPrivateIP('http://10.255.255.255')).toBe(true);
    });

    it('should block 192.168.x.x addresses', () => {
      expect(isPrivateIP('http://192.168.1.1')).toBe(true);
      expect(isPrivateIP('http://192.168.0.1')).toBe(true);
      expect(isPrivateIP('http://192.168.255.255')).toBe(true);
    });

    it('should block 172.16.x.x to 172.31.x.x addresses', () => {
      expect(isPrivateIP('http://172.16.0.1')).toBe(true);
      expect(isPrivateIP('http://172.20.0.1')).toBe(true);
      expect(isPrivateIP('http://172.31.255.255')).toBe(true);
    });

    it('should block link-local addresses (169.254.x.x)', () => {
      expect(isPrivateIP('http://169.254.169.254')).toBe(true);
      expect(isPrivateIP('http://169.254.0.1')).toBe(true);
    });

    it('should block IPv6 loopback', () => {
      expect(isPrivateIP('http://[::1]')).toBe(true);
      expect(isPrivateIP('http://::1')).toBe(true);
    });

    it('should block 0.0.0.0', () => {
      expect(isPrivateIP('http://0.0.0.0')).toBe(true);
    });

    it('should allow public IP addresses', () => {
      expect(isPrivateIP('http://8.8.8.8')).toBe(false);
      expect(isPrivateIP('https://1.1.1.1')).toBe(false);
      expect(isPrivateIP('https://example.com')).toBe(false);
      expect(isPrivateIP('https://google.com')).toBe(false);
    });

    it('should handle invalid URLs safely by returning true', () => {
      expect(isPrivateIP('not-a-url')).toBe(true);
      expect(isPrivateIP('')).toBe(true);
    });
  });

  describe('validateExternalUrl', () => {
    it('should accept valid HTTP URLs', () => {
      const result = validateExternalUrl('http://example.com');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept valid HTTPS URLs', () => {
      const result = validateExternalUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject file:// protocol', () => {
      const result = validateExternalUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Protocol');
    });

    it('should reject ftp:// protocol', () => {
      const result = validateExternalUrl('ftp://example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Protocol');
    });

    it('should reject gopher:// protocol', () => {
      const result = validateExternalUrl('gopher://example.com');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Protocol');
    });

    it('should reject data: URLs', () => {
      const result = validateExternalUrl('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Protocol');
    });

    it('should reject private IP addresses', () => {
      const result = validateExternalUrl('http://127.0.0.1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject localhost', () => {
      const result = validateExternalUrl('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject AWS metadata endpoint', () => {
      const result = validateExternalUrl('http://169.254.169.254');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private IP');
    });

    it('should reject empty string', () => {
      const result = validateExternalUrl('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject non-string values', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = validateExternalUrl(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject malformed URLs', () => {
      const result = validateExternalUrl('not a url');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should accept valid public URLs with ports', () => {
      const result = validateExternalUrl('https://example.com:8080');
      expect(result.valid).toBe(true);
    });

    it('should accept valid public URLs with paths', () => {
      const result = validateExternalUrl('https://example.com/api/endpoint');
      expect(result.valid).toBe(true);
    });
  });

  describe('isAllowedDomain', () => {
    const allowedDomains = ['example.com', 'test.org', 'workspaces.sphinx.chat'];

    it('should allow exact domain matches', () => {
      expect(isAllowedDomain('https://example.com', allowedDomains)).toBe(true);
      expect(isAllowedDomain('https://test.org', allowedDomains)).toBe(true);
    });

    it('should allow subdomains of allowed domains', () => {
      expect(isAllowedDomain('https://api.example.com', allowedDomains)).toBe(true);
      expect(isAllowedDomain('https://sub.test.org', allowedDomains)).toBe(true);
      expect(isAllowedDomain('https://app.workspaces.sphinx.chat', allowedDomains)).toBe(true);
    });

    it('should reject non-allowed domains', () => {
      expect(isAllowedDomain('https://malicious.com', allowedDomains)).toBe(false);
      expect(isAllowedDomain('https://evil.org', allowedDomains)).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isAllowedDomain('https://EXAMPLE.COM', allowedDomains)).toBe(true);
      expect(isAllowedDomain('https://Example.Com', allowedDomains)).toBe(true);
    });

    it('should handle URLs with ports', () => {
      expect(isAllowedDomain('https://example.com:8080', allowedDomains)).toBe(true);
      expect(isAllowedDomain('https://malicious.com:8080', allowedDomains)).toBe(false);
    });

    it('should handle URLs with paths', () => {
      expect(isAllowedDomain('https://example.com/path/to/resource', allowedDomains)).toBe(true);
      expect(isAllowedDomain('https://malicious.com/path', allowedDomains)).toBe(false);
    });

    it('should handle invalid URLs safely by returning false', () => {
      expect(isAllowedDomain('not-a-url', allowedDomains)).toBe(false);
      expect(isAllowedDomain('', allowedDomains)).toBe(false);
    });

    it('should not match partial domain names', () => {
      expect(isAllowedDomain('https://notexample.com', allowedDomains)).toBe(false);
      expect(isAllowedDomain('https://examplecom.evil.org', allowedDomains)).toBe(false);
    });
  });
});