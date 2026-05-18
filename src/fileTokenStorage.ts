import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { TokenStorage } from 'fastmcp/auth';

export class FileTokenStorage implements TokenStorage {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async save(key: string, value: unknown, ttl?: number): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({
      value,
      expiresAt: ttl ? Date.now() + ttl * 1000 : null,
    });
    await fs.writeFile(this.keyPath(key), payload, { mode: 0o600 });
  }

  async get(key: string): Promise<unknown | null> {
    try {
      const raw = await fs.readFile(this.keyPath(key), 'utf8');
      const { value, expiresAt } = JSON.parse(raw);
      if (expiresAt && Date.now() > expiresAt) {
        await this.delete(key);
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.keyPath(key));
    } catch {
      // already gone
    }
  }

  async cleanup(): Promise<void> {
    try {
      const files = await fs.readdir(this.dir);
      await Promise.all(files.map((f) => this.get(f.replace(/__/g, '/')))); // get() deletes expired entries
    } catch {
      // dir may not exist yet
    }
  }

  private keyPath(key: string): string {
    // Replace path separators so the key becomes a safe filename
    return path.join(this.dir, key.replace(/[/\\]/g, '__'));
  }
}
