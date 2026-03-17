import { describe, it, expect } from "vitest";
import { a2a, resultText, resultData, isError, createRoom, joinRoom } from "./helpers.js";

describe("git.commit", () => {
  it("commits files directly (no verify)", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    const res = await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "add readme",
      changes: [{ path: "README.md", content: "# Hello" }],
    });
    expect(resultText(res)).toContain("commit");
  });

  it("commits with verify=true (pending review)", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    const res = await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "needs review",
      changes: [{ path: "file.txt", content: "data" }],
      verify: true,
    });
    const data = resultData(res);
    expect(data.commit.status).toBe("pending");
    expect(data.commit.id).toBeDefined();
  });

  it("rejects without agentName", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.commit", roomId, "", {
      commitMessage: "test",
      changes: [{ path: "f.txt", content: "x" }],
    });
    expect(isError(res)).toBe(true);
  });

  it("rejects without changes", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    const res = await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "empty",
    });
    expect(isError(res)).toBe(true);
  });

  it("rejects for nonexistent room", async () => {
    const res = await a2a("git.commit", "nonexistent-xyz", "", {
      agentName: "dev",
      commitMessage: "test",
      changes: [{ path: "f.txt", content: "x" }],
    });
    expect(isError(res)).toBe(true);
  });
});

describe("git.review", () => {
  async function setupPendingCommit() {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await joinRoom(roomId, "reviewer");
    const commitRes = await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "needs review",
      changes: [{ path: "file.txt", content: "data" }],
      verify: true,
    });
    const commitId = resultData(commitRes).commit.id;
    return { roomId, commitId };
  }

  it("approves a pending commit", async () => {
    const { roomId, commitId } = await setupPendingCommit();
    const res = await a2a("git.review", roomId, "", {
      agentName: "reviewer",
      commitId,
      verdict: "approved",
    });
    expect(resultText(res)).toContain("approved");
  });

  it("rejects a pending commit", async () => {
    const { roomId, commitId } = await setupPendingCommit();
    const res = await a2a("git.review", roomId, "", {
      agentName: "reviewer",
      commitId,
      verdict: "rejected",
      comment: "Not good enough",
    });
    expect(resultText(res)).toContain("rejected");
  });

  it("rejects review without commitId", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.review", roomId, "", {
      agentName: "reviewer",
      verdict: "approved",
    });
    expect(isError(res)).toBe(true);
  });

  it("rejects review for nonexistent commit", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.review", roomId, "", {
      agentName: "reviewer",
      commitId: "nonexistent",
      verdict: "approved",
    });
    expect(isError(res)).toBe(true);
  });

  it("rejects review without agentName", async () => {
    const { roomId, commitId } = await setupPendingCommit();
    const res = await a2a("git.review", roomId, "", {
      commitId,
      verdict: "approved",
    });
    expect(isError(res)).toBe(true);
  });
});

describe("git.pending", () => {
  it("returns pending commits", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "pending",
      changes: [{ path: "f.txt", content: "x" }],
      verify: true,
    });
    const res = await a2a("git.pending", roomId);
    expect(isError(res)).toBe(false);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.pending");
    expect(isError(res)).toBe(true);
  });

  it("returns empty for nonexistent room", async () => {
    const res = await a2a("git.pending", "nonexistent-xyz");
    expect(res.result).toBeDefined();
  });
});

describe("git.log", () => {
  it("returns commit history", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "first",
      changes: [{ path: "f.txt", content: "x" }],
    });
    const res = await a2a("git.log", roomId);
    expect(isError(res)).toBe(false);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.log");
    expect(isError(res)).toBe(true);
  });

  it("returns empty for nonexistent room", async () => {
    const res = await a2a("git.log", "nonexistent-xyz");
    expect(res.result).toBeDefined();
  });
});

describe("git.read", () => {
  it("lists files", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "add file",
      changes: [{ path: "hello.txt", content: "world" }],
    });
    const res = await a2a("git.read", roomId);
    expect(resultText(res)).toContain("hello.txt");
  });

  it("reads a file", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "add file",
      changes: [{ path: "hello.txt", content: "world" }],
    });
    const res = await a2a("git.read", roomId, "", { path: "hello.txt" });
    expect(resultText(res)).toContain("world");
  });

  it("rejects nonexistent file", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "add",
      changes: [{ path: "a.txt", content: "x" }],
    });
    const res = await a2a("git.read", roomId, "", { path: "nonexistent.txt" });
    expect(isError(res)).toBe(true);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.read");
    expect(isError(res)).toBe(true);
  });
});

describe("git.diff", () => {
  it("shows commit details", async () => {
    const { roomId } = await createRoom();
    await joinRoom(roomId, "dev");
    const commitRes = await a2a("git.commit", roomId, "", {
      agentName: "dev",
      commitMessage: "test",
      changes: [{ path: "f.txt", content: "data" }],
    });
    const commitId = resultData(commitRes).commit.id;
    const res = await a2a("git.diff", roomId, "", { commitId });
    expect(isError(res)).toBe(false);
  });

  it("rejects nonexistent commit", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.diff", roomId, "", { commitId: "nonexistent" });
    expect(isError(res)).toBe(true);
  });

  it("rejects without commitId", async () => {
    const { roomId } = await createRoom();
    const res = await a2a("git.diff", roomId, "");
    expect(isError(res)).toBe(true);
  });

  it("rejects without contextId", async () => {
    const res = await a2a("git.diff", undefined, "", { commitId: "abc" });
    expect(isError(res)).toBe(true);
  });
});
