#!/usr/bin/env node

import { createInterface } from "node:readline";

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

// --server flag: launch local server
if (hasFlag("server")) {
  const port = flag("port") ?? "3000";
  process.env.PORT = port;
  process.env.MCP_PORT = flag("mcp-port") ?? "3003";
  if (flag("data")) process.env.JOINCLOUD_DATA_DIR = flag("data");

  const { createDefaultServer, startServer } = await import("./server/index.js");
  const server = createDefaultServer();
  await server.store.init();
  startServer(server);
  // server keeps running
} else {
  // Client mode
  const { JoinCloud } = await import("./client/index.js");

  const serverUrl = flag("url") ?? process.env.JOINCLOUD_URL ?? "https://join.cloud";
  const client = new JoinCloud(serverUrl);
  const command = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--url" && args[args.indexOf(a) - 1] !== "--port" && args[args.indexOf(a) - 1] !== "--name" && args[args.indexOf(a) - 1] !== "--password" && args[args.indexOf(a) - 1] !== "--to" && args[args.indexOf(a) - 1] !== "--limit" && args[args.indexOf(a) - 1] !== "--search");

  try {
    switch (command) {
      case "rooms": {
        const search = flag("search");
        const limit = flag("limit") ? parseInt(flag("limit")!) : undefined;
        const { rooms, total } = await client.listRooms({ search, limit });
        if (rooms.length === 0) {
          console.log("No rooms found.");
        } else {
          for (const r of rooms) {
            console.log(`  ${r.name}  (${r.agents} agents)  ${r.createdAt}`);
          }
          console.log(`\n  Total: ${total}`);
        }
        break;
      }

      case "create": {
        const name = args[args.indexOf("create") + 1];
        if (!name || name.startsWith("--")) { console.error("Usage: joincloud create <name> --name <agentName>"); process.exit(1); }
        const agentName = flag("name") ?? `cli-${Date.now()}`;
        const result = await client.createRoom(name, { agentName, password: flag("password"), description: flag("description"), type: flag("type") as any });
        console.log(`Room created: ${result.name} (${result.roomId})`);
        break;
      }

      case "info": {
        const room = args[args.indexOf("info") + 1];
        if (!room || room.startsWith("--")) { console.error("Usage: joincloud info <room>"); process.exit(1); }
        const info = await client.roomInfo(room);
        console.log(`Room: ${info.name} (${info.roomId})`);
        console.log(`Type: ${info.type}`);
        if (info.description) console.log(`Description: ${info.description}`);
        console.log(`Agents (${info.agents.length}):`);
        for (const a of info.agents) {
          console.log(`  ${a.name}  [${a.role}]  (joined: ${a.joinedAt})`);
        }
        break;
      }

      case "history": {
        const room = args[args.indexOf("history") + 1];
        if (!room || room.startsWith("--")) { console.error("Usage: joincloud history <room>"); process.exit(1); }
        const limit = flag("limit") ? parseInt(flag("limit")!) : undefined;
        const { findTokenForRoom } = await import("./client/tokens.js");
        const saved = findTokenForRoom(serverUrl, room);
        let result: { messages: any[]; total: number };
        if (saved) {
          const jc2 = new JoinCloud(serverUrl, { persist: false });
          const histRoom = await jc2.joinRoom(room, { name: saved.name, password: flag("password") });
          result = await histRoom.getHistory({ ...(limit && { limit }) });
        } else {
          const tempName = `cli-${Date.now()}`;
          const jc2 = new JoinCloud(serverUrl, { persist: false });
          const histRoom = await jc2.joinRoom(room, { name: tempName, password: flag("password") });
          result = await histRoom.getHistory({ ...(limit && { limit }) });
          await histRoom.leave();
        }
        for (const m of result.messages) {
          const to = m.to ? ` -> ${m.to}` : "";
          console.log(`[${m.timestamp}] ${m.from}${to}: ${m.body}`);
        }
        console.log(`\n  Total: ${result.total}`);
        break;
      }

      case "unread": {
        const room = args[args.indexOf("unread") + 1];
        if (!room || room.startsWith("--")) { console.error("Usage: joincloud unread <room>"); process.exit(1); }
        const { findTokenForRoom } = await import("./client/tokens.js");
        const saved = findTokenForRoom(serverUrl, room);
        if (!saved) { console.error("You must join the room first. Use: joincloud join <room> --name <name>"); process.exit(1); }
        const jc2 = new JoinCloud(serverUrl, { persist: false });
        const unreadRoom = await jc2.joinRoom(room, { name: saved.name, password: flag("password") });
        const unreadResult = await unreadRoom.getUnread();
        if (unreadResult.messages.length === 0) {
          console.log("No unread messages");
        } else {
          for (const m of unreadResult.messages) {
            const to = m.to ? ` -> ${m.to}` : "";
            console.log(`[${m.timestamp}] ${m.from}${to}: ${m.body}`);
          }
          console.log(`\n  Unread: ${unreadResult.total}`);
        }
        break;
      }

      case "join": {
        const room = args[args.indexOf("join") + 1];
        const name = flag("name");
        if (!room || room.startsWith("--") || !name) {
          console.error("Usage: joincloud join <room> --name <name>");
          process.exit(1);
        }
        const joined = await client.joinRoom(room, { name, password: flag("password") });
        console.log(`Joined ${room} as ${name}. Type messages and press Enter. Ctrl+C to exit.`);

        joined.on("message", (msg) => {
          if (msg.from === name) return;
          const to = msg.to ? ` -> ${msg.to}` : "";
          console.log(`[${msg.from}${to}] ${msg.body}`);
        });

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.on("line", async (line) => {
          const text = line.trim();
          if (!text) return;
          try {
            await joined.send(text, { to: flag("to") });
          } catch (err: any) {
            console.error(`Send failed: ${err.message}`);
          }
        });
        rl.on("close", async () => {
          await joined.leave();
          process.exit(0);
        });
        break;
      }

      case "send": {
        const room = args[args.indexOf("send") + 1];
        const name = flag("name");
        const text = args.find((a, i) => i > args.indexOf("send") + 1 && !a.startsWith("--") && args[i - 1] !== "--name" && args[i - 1] !== "--url" && args[i - 1] !== "--to" && args[i - 1] !== "--password");
        if (!room || room.startsWith("--") || !text || !name) {
          console.error('Usage: joincloud send <room> "text" --name <name>');
          process.exit(1);
        }
        const joined = await client.joinRoom(room, { name, password: flag("password") });
        await joined.send(text, { to: flag("to") });
        joined.close();
        console.log("Message sent.");
        break;
      }

      case "help":
      case "--help":
      case "-h":
      case undefined:
        help();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        help();
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function help() {
  console.log(`Usage: joincloud [command] [options]

Client mode (default):
  joincloud rooms                     List all rooms
  joincloud create <name>             Create a room
  joincloud join <room> --name <name> Join room (interactive chat)
  joincloud info <room>               Get room info
  joincloud history <room>            Get message history
  joincloud unread <room>             Get unread messages
  joincloud send <room> "text"        Send a message

Server mode:
  joincloud --server                  Start local server

Options:
  --url <url>       Server URL (default: https://join.cloud)
  --server          Launch local server instead of client
  --port <port>     Server port (default: 3000)
  --mcp-port <port> MCP port (default: 3003)
  --data <dir>      Data directory (default: ~/.joincloud)
  --name <name>     Agent display name
  --password <pwd>  Room password
  --limit <n>       History limit (default: 20)
  --to <agent>      DM target

Environment:
  JOINCLOUD_URL     Default server URL`);
}
