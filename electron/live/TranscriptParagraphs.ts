import type { TranscriptSegment } from "./types";
import { transcriptTextSeparator } from "./TranscriptText";

/** A reading paragraph, not an ASR utterance or a new source attribution. */
export interface TranscriptParagraph extends TranscriptSegment {
  memberIds: string[];
}

// Presentation choices: do not delay the first interim result to await a gap.
export const PARAGRAPH_GAP_MS = 2500;
export const PARAGRAPH_CHARACTERS = 100;

function timed(segment: TranscriptSegment): boolean {
  return Number.isFinite(segment.startMs) && Number.isFinite(segment.endMs) &&
    segment.startMs! >= 0 && segment.endMs! >= segment.startMs!;
}

function sameChannel(a: TranscriptSegment, b: TranscriptSegment): boolean {
  // Display labels and shortened participant IDs cannot establish identity.
  // Legacy rows without the boundary owner's opaque ID remain separate.
  return Boolean(a.channelId) && a.channelId === b.channelId && a.captureEpoch === b.captureEpoch;
}

function characters(text: string): number {
  let count = 0;
  for (const _character of text) if (++count > PARAGRAPH_CHARACTERS) break;
  return count;
}

/** Recompute from the session owner's stable array order. receivedAt changes on
 * corrections and must never reorder an older finalized row behind a newer one.
 * Input objects and ASR final/partial identities remain untouched.
 */
export function projectTranscriptParagraphs(segments: readonly TranscriptSegment[]): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  let previous: TranscriptSegment | undefined;
  for (const segment of segments) {
    const paragraph = paragraphs.at(-1);
    const gap = previous && timed(previous) && timed(segment) ? segment.startMs! - previous.endMs! : undefined;
    const contiguous = paragraph && previous?.isFinal && sameChannel(previous, segment) &&
      gap !== undefined && gap >= 0 && gap <= PARAGRAPH_GAP_MS;
    const separator = contiguous ? transcriptTextSeparator(paragraph.text, segment.text) : "";
    // Bound counting and avoid allocating a combined oversized raw segment.
    const join = contiguous && characters(paragraph.text) + characters(separator) + characters(segment.text) <= PARAGRAPH_CHARACTERS;
    if (join) {
      paragraph.text += separator + segment.text;
      paragraph.memberIds.push(segment.id);
      paragraph.endMs = segment.endMs;
      paragraph.isFinal = paragraph.isFinal && segment.isFinal;
    } else {
      paragraphs.push({ ...segment, memberIds: [segment.id] });
    }
    previous = segment;
  }
  return paragraphs;
}
