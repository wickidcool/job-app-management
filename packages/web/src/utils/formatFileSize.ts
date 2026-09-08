/**
 * The one way this app renders a byte count.
 *
 * There were three copies of this helper — `ResumeExportList`, `ResumeManager` and
 * `ResumeUpload` — and they had drifted. The first two carried the B/KB/MB ladder below;
 * the third divided by 1024*1024 and always printed MB.
 *
 * That copy sat on the upload progress bar, where the accepted formats (`.pdf`, `.docx`,
 * `.txt`) are routinely 2-80KB for a resume. `.toFixed(1)` on MB has one step per ~105KB,
 * so a 42KB .docx rendered `0.0 MB / 0.0 MB` at every progress event from 0% to 100%: the
 * byte counter never moved, and it asserted the file was zero-sized during a healthy
 * upload. Anything under ~51KB showed a total of `0.0 MB`.
 *
 * This is the same shape as WIC-1382, where the duplicated upload *limit* went stale and
 * refused a 7MB resume the server would have accepted. `constants/upload.ts` fixed that one
 * by giving the number a single home; this module does the same for the rendering. Import
 * it rather than re-deriving the ladder — a fourth private copy is how the third one drifted.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
