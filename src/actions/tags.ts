import type { A2AMessage } from "../a2a.js";
import { reply, error } from "../helpers.js";
import { getRoomById } from "../store.js";
import { botNotify } from "../bot.js";
import { createTag, listTags, deleteTag } from "../git.js";

export async function handleTagAction(
  action: string,
  contextId: string | undefined,
  metadata: Record<string, unknown> | undefined,
): Promise<A2AMessage | null> {
  if (action === "git.tag.create") {
    if (!contextId) return error("contextId (roomId) required");
    const tagName = metadata?.tag as string;
    if (!tagName) return error("tag required in metadata");
    const ref = metadata?.ref as string | undefined;
    await createTag(contextId, tagName, ref);
    await botNotify(contextId, `Tag "${tagName}" created`);
    return reply(`Tag created: ${tagName}`, contextId, { tag: tagName });
  }

  if (action === "git.tag.list") {
    if (!contextId) return error("contextId (roomId) required");
    if (!(await getRoomById(contextId))) return error(`Room not found: ${contextId}`);
    const tags = await listTags(contextId);
    return reply(tags.join("\n") || "(no tags)", contextId, { tags });
  }

  if (action === "git.tag.delete") {
    if (!contextId) return error("contextId (roomId) required");
    const tagName = metadata?.tag as string;
    if (!tagName) return error("tag required in metadata");
    const existing = await listTags(contextId);
    if (!existing.includes(tagName)) return error(`Tag not found: ${tagName}`);
    await deleteTag(contextId, tagName);
    return reply(`Tag deleted: ${tagName}`, contextId);
  }

  return null;
}
