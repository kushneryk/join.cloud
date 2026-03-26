import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const TOKEN_DIR = join(homedir(), ".joincloud");
const TOKEN_FILE = join(TOKEN_DIR, "tokens.json");

type TokenStore = Record<string, string>; // "server|room|name" -> agentToken

function load(): TokenStore {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function save(store: TokenStore): void {
  mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

function key(server: string, room: string, name: string): string {
  return `${server}|${room}|${name}`;
}

export function getToken(server: string, room: string, name: string): string | undefined {
  return load()[key(server, room, name)];
}

export function saveToken(server: string, room: string, name: string, token: string): void {
  const store = load();
  store[key(server, room, name)] = token;
  save(store);
}

export function findTokenForRoom(server: string, room: string): { name: string; token: string } | undefined {
  const store = load();
  const prefix = `${server}|${room}|`;
  for (const [k, token] of Object.entries(store)) {
    if (k.startsWith(prefix)) {
      const name = k.slice(prefix.length);
      return { name, token };
    }
  }
  return undefined;
}

export function removeToken(server: string, room: string, name: string): void {
  const store = load();
  delete store[key(server, room, name)];
  save(store);
}
