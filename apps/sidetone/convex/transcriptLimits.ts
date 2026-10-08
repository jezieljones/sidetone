import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const MAX_TRANSCRIPT_SEGMENTS = 1000;
export const MAX_SEGMENT_CHARACTERS = 1024;

// The total read is bounded by both segment count and per-segment text size.
// Never summarize a silently truncated transcript.
export async function readTranscript(ctx: Pick<QueryCtx | MutationCtx, "db">, callSessionId: Id<"callSessions">) {
  const segments = await ctx.db.query("transcriptSegments")
    .withIndex("by_call_session_time", q => q.eq("callSessionId", callSessionId))
    .order("asc").take(MAX_TRANSCRIPT_SEGMENTS + 1);
  if (segments.length > MAX_TRANSCRIPT_SEGMENTS) throw new Error("This recording exceeds the transcript limit. Split it into smaller recordings.");
  return segments;
}

export function normalizeSegments<T extends { text: string; startMs: number; endMs: number }>(segments: T[]): T[] {
  const result: T[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    // Splitting by code point preserves Unicode and all transcript content.
    const chars = Array.from(text);
    for (let offset = 0; offset < chars.length; offset += MAX_SEGMENT_CHARACTERS) {
      const end = Math.min(chars.length, offset + MAX_SEGMENT_CHARACTERS);
      result.push({ ...segment, text: chars.slice(offset, end).join(""),
        startMs: segment.startMs + (segment.endMs - segment.startMs) * offset / chars.length,
        endMs: segment.startMs + (segment.endMs - segment.startMs) * end / chars.length });
      if (result.length > MAX_TRANSCRIPT_SEGMENTS) throw new Error("This recording exceeds the transcript limit. Split it into smaller recordings.");
    }
  }
  return result;
}
