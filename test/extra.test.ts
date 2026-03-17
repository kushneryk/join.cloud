import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, createRoom, joinRoom } from "./helpers.js";

describe("help", () => {
  it("returns documentation", async () => {
    const res = await a2a("help");
    expect(resultText(res).length).toBeGreaterThan(100);
  });
});

describe("git.history", () => {
  it("returns git log", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "first",
      changes: [{ path: "f.txt", content: "x" }],
    });
    const res = await a2a("git.history", roomId);
    expect(isError(res)).toBe(false);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.history");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent room", async () => {
    const res = await a2a("git.history", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
  });
});

describe("git.status", () => {
  it("returns status", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "init",
      changes: [{ path: "f.txt", content: "x" }],
    });
    const res = await a2a("git.status", roomId);
    expect(isError(res)).toBe(false);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.status");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent room", async () => {
    const res = await a2a("git.status", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
  });
});

describe("git.revert", () => {
  it("reverts a commit", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    const commitRes = await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "to revert",
      changes: [{ path: "f.txt", content: "x" }],
    });
    const commitId = resultData(commitRes).commit.id;
    const res = await a2a("git.revert", roomId, "", { agentName: "dev", commitId });
    expect(isError(res)).toBe(false);
  });

  it("rejects without commitId", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.revert", roomId, "", { agentName: "dev" });
    expect(isError(res)).toBe(true);
  });

  it("rejects without agentName", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.revert", roomId, "", { commitId: "abc" });
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent commit", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "init",
      changes: [{ path: "f.txt", content: "x" }],
    });
    const res = await a2a("git.revert", roomId, "", { agentName: "dev", commitId: "nonexistent" });
    expect(isError(res)).toBe(true);
  });
});

describe("git.blame", () => {
  it("returns blame info", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "add file",
      changes: [{ path: "f.txt", content: "line1\nline2" }],
    });
    const res = await a2a("git.blame", roomId, "", { path: "f.txt" });
    expect(isError(res)).toBe(false);
  });

  it("rejects without path", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.blame", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent file", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "init",
      changes: [{ path: "f.txt", content: "x" }],
    });
    const res = await a2a("git.blame", roomId, "", { path: "nonexistent.txt" });
    expect(isError(res)).toBe(true);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.blame", undefined, "", { path: "f.txt" });
    expect(isError(res)).toBe(true);
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
