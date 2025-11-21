import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/check-url/route';

describe('GET /api/check-url - SSRF Protection', () => {
  describe('SSRF Protection', () => {
    it('should reject localhost URLs', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://localhost:3000');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
      expect(data.isReady).toBe(false);
    });

    it('should reject 127.0.0.1 URLs', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://127.0.0.1');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
    });

    it('should reject private network IPs (10.x.x.x)', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://10.0.0.1');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
    });

    it('should reject private network IPs (192.168.x.x)', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://192.168.1.1');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
    });

    it('should reject private network IPs (172.16.x.x)', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://172.16.0.1');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
    });

    it('should reject AWS metadata endpoint', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://169.254.169.254');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
    });

    it('should reject IPv6 loopback', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://[::1]:3000');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Private IP');
    });

    it('should reject file:// protocol', async () => {
      const request = new Request('http://test.com/api/check-url?url=file:///etc/passwd');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Protocol');
    });

    it('should reject ftp:// protocol', async () => {
      const request = new Request('http://test.com/api/check-url?url=ftp://example.com');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Protocol');
    });

    it('should reject data: URLs', async () => {
      const request = new Request('http://test.com/api/check-url?url=data:text/html,<script>alert(1)</script>');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('Protocol');
    });
  });

  describe('Valid URL Handling', () => {
    it('should accept valid HTTPS URLs', async () => {
      const request = new Request('http://test.com/api/check-url?url=https://google.com');
      const response = await GET(request);

      // This will attempt to fetch google.com - may succeed or fail based on network
      // We just verify it passed validation (not rejected with 400)
      expect(response.status).not.toBe(400);
    });

    it('should accept valid HTTP URLs', async () => {
      const request = new Request('http://test.com/api/check-url?url=http://example.com');
      const response = await GET(request);

      // Verify validation passed (not rejected with 400)
      expect(response.status).not.toBe(400);
    });
  });

  describe('Edge Cases', () => {
    it('should reject missing URL parameter', async () => {
      const request = new Request('http://test.com/api/check-url');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('URL parameter is required');
    });

    it('should reject malformed URLs', async () => {
      const request = new Request('http://test.com/api/check-url?url=not-a-valid-url');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBeDefined();
    });
  });
});