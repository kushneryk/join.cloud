import { describe, it, expect } from "vitest";
import { a2a, resultText, isError, createRoom, joinRoom } from "./helpers.js";

describe("help", () => {
  it("returns documentation", async () => {
    const res = await a2a("help");
    expect(resultText(res).length).toBeGreaterThan(100);
  });
});

describe("unknown action", () => {
  it("returns error for unknown action", async () => {
    const res = await a2a("nonexistent.action");
    expect(isError(res)).toBe(true);
    expect(resultText(res)).toContain("Unknown action");
  });
});

describe("password-protected rooms", () => {
  it("allows joining with correct password", async () => {
    const { roomId } = await createRoom(undefined, "secret");
    const res = await joinRoom(roomId, "agent1", { password: "secret" });
    expect(resultText(res)).toContain("Joined");
  });

  it("rejects join with wrong password", async () => {
    const { roomId } = await createRoom(undefined, "secret");
    const res = await joinRoom(roomId, "agent1", { password: "wrong" });
    expect(isError(res)).toBe(true);
  });

  it("rejects join without password", async () => {
    const { roomId } = await createRoom(undefined, "secret");
    const res = await joinRoom(roomId, "agent1");
    expect(isError(res)).toBe(true);
  });
});
