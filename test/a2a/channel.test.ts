import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, uniqueName, createRoom, joinRoom, sendMsg, updateRoom } from "../helpers.js";

// ============================================================
// Channel type rooms
// ============================================================
describe("A2A channel rooms", () => {
  it("creates a channel room with correct type", async () => {
    const { name } = await createRoom(undefined, undefined, { type: "channel" });
    const info = resultData(await a2a("room.info", name));
    expect(info.type).toBe("channel");
  });

  it("admin can send in channel", async () => {
    const { agentToken } = await createRoom(undefined, undefined, { type: "channel" });
    const res = await sendMsg(agentToken, "Admin broadcast");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("sent");
  });

  it("member cannot send in channel", async () => {
    const { name } = await createRoom(undefined, undefined, { type: "channel" });
    const { agentToken: memberToken } = await joinRoom(name, "member1");
    const res = await sendMsg(memberToken, "Should fail");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Only admins can post in channels");
  });

  it("member cannot DM in channel", async () => {
    const { name } = await createRoom(undefined, undefined, { type: "channel" });
    const { agentToken: memberToken } = await joinRoom(name, "member1");
    const res = await sendMsg(memberToken, "DM attempt", "creator");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Only admins can post in channels");
  });

  it("group rooms allow all members to send", async () => {
    const { name } = await createRoom();
    const { agentToken: memberToken } = await joinRoom(name, "member1");
    const res = await sendMsg(memberToken, "Member message");
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("sent");
  });

  it("switching channel to group allows member to send", async () => {
    const { name, agentToken } = await createRoom(undefined, undefined, { type: "channel" });
    const { agentToken: memberToken } = await joinRoom(name, "member1");

    // Member can't send in channel
    const res1 = await sendMsg(memberToken, "Blocked");
    expect(isError(res1)).toBe(true);

    // Admin switches to group
    await updateRoom(agentToken, { type: "group" });

    // Now member can send
    const res2 = await sendMsg(memberToken, "Allowed");
    expect(isError(res2)).toBe(false);
    expect(resultText(res2)).toContain("sent");
  });

  it("switching group to channel blocks member", async () => {
    const { name, agentToken } = await createRoom();
    const { agentToken: memberToken } = await joinRoom(name, "member1");

    // Member can send in group
    const res1 = await sendMsg(memberToken, "Allowed");
    expect(isError(res1)).toBe(false);

    // Admin switches to channel
    await updateRoom(agentToken, { type: "channel" });

    // Now member can't send
    const res2 = await sendMsg(memberToken, "Blocked");
    expect(isError(res2)).toBe(true);
    expect(resultText(res2)).toContain("Only admins can post in channels");
  });

  it("default room type is group", async () => {
    const { name } = await createRoom();
    const info = resultData(await a2a("room.info", name));
    expect(info.type).toBe("group");
  });
});
