import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, createRoom, joinRoom } from "./helpers.js";

async function setupRoomWithCommit() {
  const { roomId } = await createRoom();
  await joinRoom(roomId, "dev");
  await a2a("git.commit", roomId, "", {
    agentName: "dev",
    commitMessage: "initial",
    changes: [{ path: "f.txt", content: "x" }],
  });
  return roomId;
}

describe("git.branch.create", () => {
  it("creates a branch", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.create", roomId, "", { branch: "feature" });
    expect(isError(res)).toBe(false);
  });

  it("rejects without branch name", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.create", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.branch.create", undefined, "", { branch: "feature" });
    expect(isError(res)).toBe(true);
  });

  it("rejects for nonexistent room", async () => {
    const res = await a2a("git.branch.create", "nonexistent-xyz", "", { branch: "feature" });
    expect(isError(res)).toBe(true);
  });
});

describe("git.branch.list", () => {
  it("lists branches", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.list", roomId);
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("main");
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.branch.list");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent room", async () => {
    const res = await a2a("git.branch.list", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
  });
});

describe("git.branch.checkout", () => {
  it("checks out a branch", async () => {
    const roomId = await setupRoomWithCommit();
    await a2a("git.branch.create", roomId, "", { branch: "dev-branch" });
    const res = await a2a("git.branch.checkout", roomId, "", { branch: "dev-branch" });
    expect(isError(res)).toBe(false);
  });

  it("rejects nonexistent branch", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.checkout", roomId, "", { branch: "nonexistent" });
    expect(isError(res)).toBe(true);
  });

  it("rejects without branch name", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.checkout", roomId, "");
    expect(isError(res)).toBe(true);
  });
});

describe("git.branch.delete", () => {
  it("deletes a branch", async () => {
    const roomId = await setupRoomWithCommit();
    await a2a("git.branch.create", roomId, "", { branch: "to-delete" });
    const res = await a2a("git.branch.delete", roomId, "", { branch: "to-delete" });
    expect(isError(res)).toBe(false);
  });

  it("rejects without branch name", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.delete", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent branch", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.branch.delete", roomId, "", { branch: "nonexistent" });
    expect(isError(res)).toBe(true);
  });
});

describe("git.tag.create", () => {
  it("creates a tag", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.tag.create", roomId, "", { tag: "v1.0" });
    expect(isError(res)).toBe(false);
  });

  it("rejects without tag name", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.tag.create", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.tag.create", undefined, "", { tag: "v1.0" });
    expect(isError(res)).toBe(true);
  });
});

describe("git.tag.list", () => {
  it("lists tags", async () => {
    const roomId = await setupRoomWithCommit();
    await a2a("git.tag.create", roomId, "", { tag: "v1.0" });
    const res = await a2a("git.tag.list", roomId);
    expect(isError(res)).toBe(false);
    expect(resultText(res)).toContain("v1.0");
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.tag.list");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent room", async () => {
    const res = await a2a("git.tag.list", "nonexistent-xyz");
    expect(isError(res)).toBe(true);
  });
});

describe("git.tag.delete", () => {
  it("deletes a tag", async () => {
    const roomId = await setupRoomWithCommit();
    await a2a("git.tag.create", roomId, "", { tag: "v-del" });
    const res = await a2a("git.tag.delete", roomId, "", { tag: "v-del" });
    expect(isError(res)).toBe(false);
  });

  it("rejects without tag name", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.tag.delete", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects nonexistent tag", async () => {
    const roomId = await setupRoomWithCommit();
    const res = await a2a("git.tag.delete", roomId, "", { tag: "nonexistent" });
    expect(isError(res)).toBe(true);
  });
});
