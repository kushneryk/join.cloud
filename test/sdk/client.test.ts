import { describe, it, expect, afterEach } from "vitest";
import { JoinCloud, Room } from "../../src/client/index.js";
import { uniqueName } from "../helpers.js";

const SERVER = process.env.TEST_URL ?? "http://localhost:3000";

function client() {
  return new JoinCloud(SERVER, { persist: false });
}

const rooms: Room[] = [];
afterEach(async () => {
  for (const r of rooms.splice(0)) {
    try { r.close(); } catch {}
  }
});

// ============================================================
// JoinCloud constructor
// ============================================================
describe("SDK JoinCloud constructor", () => {
  it("defaults to join.cloud", () => {
    const jc = new JoinCloud();
    expect(jc.serverUrl).toBe("https://join.cloud");
  });

  it("accepts custom server URL", () => {
    const jc = new JoinCloud("http://localhost:9999");
    expect(jc.serverUrl).toBe("http://localhost:9999");
  });

  it("strips trailing slash", () => {
    const jc = new JoinCloud("http://localhost:3000/");
    expect(jc.serverUrl).toBe("http://localhost:3000");
  });
});

// ============================================================
// listRooms
// ============================================================
describe("SDK listRooms", () => {
  // --- Positive ---
  it("returns array of rooms", async () => {
    const jc = client();
    await jc.createRoom(uniqueName("sdk-room"), { agentName: "creator" });
    const { rooms: list, total } = await jc.listRooms();
    expect(list).toBeInstanceOf(Array);
    expect(list.length).toBeGreaterThan(0);
    expect(typeof total).toBe("number");
  });

  it("rooms have expected fields", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const { rooms: list } = await jc.listRooms();
    const room = list.find((r) => r.name === name);
    expect(room).toBeTruthy();
    expect(room!.createdAt).toBeTruthy();
    expect(typeof room!.agents).toBe("number");
    expect(typeof room!.description).toBe("string");
    expect(typeof room!.type).toBe("string");
  });

  // --- Negative ---
  it("throws on unreachable server", async () => {
    const jc = new JoinCloud("http://localhost:1", { persist: false });
    await expect(jc.listRooms()).rejects.toThrow();
  });
});

// ============================================================
// createRoom
// ============================================================
describe("SDK createRoom", () => {
  // --- Positive ---
  it("creates room and returns roomId, name, and agentToken", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    const result = await jc.createRoom(name, { agentName: "creator" });
    expect(result.roomId).toBeTruthy();
    expect(result.name).toBe(name);
    expect(result.agentToken).toBeTruthy();
  });

  it("creates room with password", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    const result = await jc.createRoom(name, { agentName: "creator", password: "secret" });
    expect(result.roomId).toBeTruthy();
    expect(result.agentToken).toBeTruthy();
  });

  it("creates room with description and type", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator", description: "My room", type: "channel" });
    const info = await jc.roomInfo(name);
    expect(info.description).toBe("My room");
    expect(info.type).toBe("channel");
  });

  // --- Negative ---
  it("throws for reserved name", async () => {
    const jc = client();
    await expect(jc.createRoom("mcp", { agentName: "creator" })).rejects.toThrow();
  });

  it("throws for duplicate room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator1" });
    await expect(jc.createRoom(name, { agentName: "creator2" })).rejects.toThrow(/already exists/i);
  });
});

// ============================================================
// roomInfo
// ============================================================
describe("SDK roomInfo", () => {
  // --- Positive ---
  it("returns room info with creator", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const info = await jc.roomInfo(name);
    expect(info.roomId).toBeTruthy();
    expect(info.name).toBe(name);
    expect(info.agents).toBeInstanceOf(Array);
    expect(info.agents.length).toBe(1);
    expect(info.agents[0].name).toBe("creator");
    expect(info.agents[0].role).toBe("admin");
  });

  it("includes additional agents in info", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "sdk-agent" });
    rooms.push(room);
    const info = await jc.roomInfo(name);
    expect(info.agents.length).toBe(2);
    const agent = info.agents.find((a) => a.name === "sdk-agent");
    expect(agent).toBeTruthy();
    expect(agent!.role).toBe("member");
    expect(agent!.joinedAt).toBeTruthy();
  });

  // --- Negative ---
  it("throws for non-existent room", async () => {
    const jc = client();
    await expect(jc.roomInfo("nonexistent-room-xyz")).rejects.toThrow(/not found/i);
  });
});

// ============================================================
// joinRoom
// ============================================================
describe("SDK joinRoom", () => {
  // --- Positive ---
  it("returns Room instance with properties", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "agent1" });
    rooms.push(room);
    expect(room).toBeInstanceOf(Room);
    expect(room.roomName).toBe(name);
    expect(room.roomId).toBeTruthy();
    expect(room.agentName).toBe("agent1");
    expect(room.agentToken).toBeTruthy();
  });

  it("SSE is connected after joinRoom resolves", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "agent1" });
    rooms.push(room);
    await expect(room.connected()).resolves.toBeUndefined();
  });

  it("joins with password (colon syntax)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator", password: "pass" });
    const room = await jc.joinRoom(`${name}:pass`, { name: "agent1" });
    rooms.push(room);
    expect(room.agentToken).toBeTruthy();
  });

  it("joins with password (separate param)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator", password: "Secret123" });
    const room = await jc.joinRoom(name, { name: "agent1", password: "Secret123" });
    rooms.push(room);
    expect(room.agentToken).toBeTruthy();
  });

  it("joins with uppercase password (colon syntax)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator", password: "MyPass_XYZ" });
    const room = await jc.joinRoom(`${name}:MyPass_XYZ`, { name: "agent1" });
    rooms.push(room);
    expect(room.agentToken).toBeTruthy();
  });

  it("rejects wrong password", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator", password: "correct" });
    await expect(jc.joinRoom(`${name}:wrong`, { name: "a" })).rejects.toThrow(/invalid room password/i);
  });

  // --- Negative ---
  it("throws for non-existent room", async () => {
    const jc = client();
    await expect(jc.joinRoom("no-such-room", { name: "a" })).rejects.toThrow(/not found/i);
  });

  it("throws for duplicate agent name", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "agent1" });
    rooms.push(room);
    const jc2 = client();
    await expect(jc2.joinRoom(name, { name: "agent1" })).rejects.toThrow(/already taken/i);
  });
});

// ============================================================
// Room.send
// ============================================================
describe("SDK Room.send", () => {
  // --- Positive ---
  it("sends broadcast message", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "sender" });
    rooms.push(room);
    await expect(room.send("hello")).resolves.toBeUndefined();
  });

  it("sends DM with to option", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "sender" });
    rooms.push(room);
    await expect(room.send("dm text", { to: "someone" })).resolves.toBeUndefined();
  });

  // --- Negative ---
  it("throws after leaving room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "sender" });
    await room.leave();
    await expect(room.send("hello")).rejects.toThrow();
  });
});

// ============================================================
// Room.getHistory
// ============================================================
describe("SDK Room.getHistory", () => {
  // --- Positive ---
  it("returns message array with total", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    await room.send("msg1");
    await room.send("msg2");
    const { messages: msgs, total } = await room.getHistory();
    expect(msgs).toBeInstanceOf(Array);
    expect(msgs.length).toBeGreaterThanOrEqual(2);
    expect(typeof total).toBe("number");
  });

  it("respects limit option", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    for (let i = 0; i < 5; i++) await room.send(`m${i}`);
    const { messages: msgs } = await room.getHistory({ limit: 2 });
    expect(msgs.length).toBeLessThanOrEqual(2);
  });

  it("respects offset option", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    for (let i = 0; i < 5; i++) await room.send(`m${i}`);
    const { messages: all } = await room.getHistory({ limit: 100 });
    const { messages: offset } = await room.getHistory({ limit: 100, offset: 2 });
    expect(offset.length).toBe(all.length - 2);
  });

  it("messages have correct fields", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    await room.send("test body");
    const { messages: msgs } = await room.getHistory();
    const msg = msgs.find((m) => m.body === "test body");
    expect(msg).toBeTruthy();
    expect(msg!.id).toBeTruthy();
    expect(msg!.roomId).toBeTruthy();
    expect(msg!.from).toBe("hist-agent");
    expect(msg!.timestamp).toBeTruthy();
  });

  // --- Negative ---
  it("returns empty for fresh room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "hist-agent" });
    rooms.push(room);
    const { messages: msgs } = await room.getHistory();
    const userMsgs = msgs.filter((m) => m.from !== "room-bot");
    expect(userMsgs.length).toBe(0);
  });
});

// ============================================================
// Room.leave
// ============================================================
describe("SDK Room.leave", () => {
  // --- Positive ---
  it("leaves room successfully", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "leaver" });
    await expect(room.leave()).resolves.toBeUndefined();
  });

  it("agent removed from room info after leave", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "leaver" });
    await room.leave();
    const info = await jc.roomInfo(name);
    expect(info.agents.find((a) => a.name === "leaver")).toBeUndefined();
  });

  // --- Negative ---
  it("throws when leaving with invalid token (already left)", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "leaver" });
    await room.leave();
    await expect(room.leave()).rejects.toThrow();
  });
});

// ============================================================
// Room.close
// ============================================================
describe("SDK Room.close", () => {
  it("closes SSE without leaving room", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    const room = await jc.joinRoom(name, { name: "closer" });
    room.close();
    const info = await jc.roomInfo(name);
    expect(info.agents.find((a) => a.name === "closer")).toBeTruthy();
  });
});

// ============================================================
// Room events
// ============================================================
describe("SDK Room events", () => {
  it("emits 'message' for incoming messages", async () => {
    const jc1 = client();
    const jc2 = client();
    const name = uniqueName("sdk-room");
    await jc1.createRoom(name, { agentName: "creator" });
    const room1 = await jc1.joinRoom(name, { name: "listener" });
    rooms.push(room1);

    const received: any[] = [];
    room1.on("message", (msg) => received.push(msg));

    const room2 = await jc2.joinRoom(name, { name: "speaker" });
    rooms.push(room2);
    await room2.send("hello from speaker");

    await new Promise((r) => setTimeout(r, 500));
    const found = received.find((m) => m.body === "hello from speaker");
    expect(found).toBeTruthy();
    expect(found.from).toBe("speaker");
  });

  it("emits bot join/leave notifications", async () => {
    const jc1 = client();
    const jc2 = client();
    const name = uniqueName("sdk-room");
    await jc1.createRoom(name, { agentName: "creator" });
    const room1 = await jc1.joinRoom(name, { name: "watcher" });
    rooms.push(room1);

    const received: any[] = [];
    room1.on("message", (msg) => received.push(msg));

    const room2 = await jc2.joinRoom(name, { name: "joiner" });
    rooms.push(room2);

    await new Promise((r) => setTimeout(r, 500));
    const joinMsg = received.find((m) => m.from === "room-bot" && m.body.includes("joiner joined"));
    expect(joinMsg).toBeTruthy();
  });
});

// ============================================================
// Room admin methods
// ============================================================
describe("SDK Room admin methods", () => {
  it("promote and demote", async () => {
    const jc = client();
    const name = uniqueName("sdk-room");
    await jc.createRoom(name, { agentName: "creator" });
    // Join as a different agent who will be admin via promote test
    const room = await jc.joinRoom(name, { name: "joiner" });
    rooms.push(room);

    // Use A2A helper to promote joiner (via creator's token) then test SDK methods
    // Instead: use creator token directly. Since SDK admin methods go through A2A,
    // we test via the admin helper. But we need an admin Room instance.
    // Simplest: use the A2A helpers for the admin action, test SDK for the member.
    // Actually, let's test differently: create room, join second agent, use A2A to get creator token and promote.
    const { a2a, resultData } = await import("../helpers.js");
    const infoRes = await a2a("room.info", name);
    const agents = resultData(infoRes).agents;
    // Creator is admin — let's use A2A promote/demote to test
    // But we want to test SDK Room methods. Let's create a fresh approach:
    // Create room with creator, join as admin2, promote admin2, then admin2 can use SDK methods.
    rooms[rooms.length - 1].close();
    rooms.pop();

    // Fresh approach: create room, get creator token from helper, join as member, promote via helper
    const { createRoom: createRoomHelper, joinRoom: joinRoomHelper, promoteAgent, demoteAgent } = await import("../helpers.js");
    const { agentToken: creatorToken, name: rName } = await createRoomHelper();
    const jc3 = client();
    const memberRoom = await jc3.joinRoom(rName, { name: "member1" });
    rooms.push(memberRoom);

    // Promote member1 using creator's token (A2A helper)
    await promoteAgent(creatorToken, "member1");
    let info = await jc3.roomInfo(rName);
    expect(info.agents.find((a) => a.name === "member1")!.role).toBe("admin");

    // Now member1 (now admin) can use SDK to demote themselves... but let's just verify promote worked
    // and test demote via the SDK Room method from the promoted agent
    await expect(memberRoom.demote("member1")).resolves.toBeUndefined();
    info = await jc3.roomInfo(rName);
    expect(info.agents.find((a) => a.name === "member1")!.role).toBe("member");
  });

  it("kick", async () => {
    const { createRoom: createRoomHelper, joinRoom: joinRoomHelper } = await import("../helpers.js");
    const { agentToken: creatorToken, name: rName } = await createRoomHelper();

    const jc = client();
    // Join as target
    const target = await jc.joinRoom(rName, { name: "target" });
    rooms.push(target);

    // Use A2A to kick (admin action from creator)
    const { kickAgent } = await import("../helpers.js");
    await kickAgent(creatorToken, "target");
    const info = await jc.roomInfo(rName);
    expect(info.agents.find((a) => a.name === "target")).toBeUndefined();
  });

  it("update room description and type", async () => {
    const { createRoom: createRoomHelper } = await import("../helpers.js");
    const { agentToken: creatorToken, name: rName } = await createRoomHelper();

    const { updateRoom: updateRoomHelper } = await import("../helpers.js");
    const { isError, resultText } = await import("../helpers.js");
    const res = await updateRoomHelper(creatorToken, { description: "Updated", type: "channel" });
    expect(isError(res)).toBe(false);

    const jc = client();
    const info = await jc.roomInfo(rName);

    await expect(room.update({ description: "Updated", type: "channel" })).resolves.toBeUndefined();
    const info = await jc.roomInfo(name);
    expect(info.description).toBe("Updated");
    expect(info.type).toBe("channel");
  });

  it("member cannot promote", async () => {
    const { createRoom: createRoomHelper } = await import("../helpers.js");
    const { name: rName } = await createRoomHelper();

    const jc2 = client();
    const member = await jc2.joinRoom(rName, { name: "member1" });
    rooms.push(member);

    await expect(member.promote("creator")).rejects.toThrow(/admin role required/i);
  });
});
