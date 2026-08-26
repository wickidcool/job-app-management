import { useState } from 'react';
import type { CoverLetterVariant } from '../services/api/types';

/**
 * Semantic depth for this component's heading. `1` is deliberately excluded: the
 * page `<h1>` names the route, and a preview pane is never the route.
 */
export type CoverLetterPreviewHeadingLevel = 2 | 3 | 4 | 5 | 6;

interface CoverLetterPreviewProps {
  content: string;
  variant?: CoverLetterVariant;
  wordCount?: number;
  /**
   * Whether to offer the Copy / Download controls. This gates the *buttons* only —
   * the header bar and its heading always render, because the pane's identity is
   * not an export concern (WIC-1569). `CoverLetterGenerator` passes `false`: the
   * letter is not saved yet, so offering to export it is premature, but the pane
   * still has to be named beside its labelled "Editor" sibling.
   */
  showExportActions?: boolean;
  isExporting?: boolean;
  onCopy?: () => void;
  onDownload?: (format: 'docx') => void;
  /**
   * The heading level this instance should render at, so the host page's outline
   * stays gap-free. Defaults to `2`, correct when the preview is the sole content
   * of a page under its `<h1>` (`CoverLetterDetail`). `CoverLetterGenerator`
   * renders it as one half of a split pane inside a section that owns its own
   * `<h2>`, and passes `3`.
   *
   * The rendered size does not change with the level — see the note on the
   * heading below.
   */
  headingLevel?: CoverLetterPreviewHeadingLevel;
}

export function CoverLetterPreview({
  content,
  variant,
  wordCount,
  showExportActions = true,
  isExporting = false,
  onCopy,
  onDownload,
  headingLevel = 2,
}: CoverLetterPreviewProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const handleCopy = async () => {
    if (!onCopy) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopyStatus('copied');
      onCopy();
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const calculatedWordCount =
    wordCount || (content.trim() === '' ? 0 : content.trim().split(/\s+/).length);

  const Heading = `h${headingLevel}` as `h${CoverLetterPreviewHeadingLevel}`;

  const formatContent = () => {
    return content.split('\n').map((paragraph, idx) => {
      if (paragraph.trim() === '') return null;
      return (
        <p key={idx} className="mb-4">
          {paragraph}
        </p>
      );
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header.
          The bar and its heading render unconditionally; only the button group is gated
          on `showExportActions` (WIC-1569). These were one block, which conflated two
          separate questions — "may this letter be exported yet?" and "what is this pane?"
          — and the generator, which answers no to the first, was silently getting no
          answer to the second: a labelled "📝 Editor" beside an anonymous run of prose,
          and a `border-b` that crossed half the box and stopped at the pane divider.
          Keep them split. `showExportActions` now controls exactly what its name says.

          `px-4 py-3` matches the editor pane's bar (`CoverLetterGenerator:561`), which is
          load-bearing rather than cosmetic: in the generator neither bar has buttons, so
          both are `py-3` + a heading line-box = 3.25rem and the panes align exactly. Under
          `CoverLetterDetail` the bar grows to 4rem around the `h-10` buttons, which is fine
          — nothing sits beside it there. `p-4` here would leave the generator's panes 8px
          out of true. */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        {/* The tag comes from `headingLevel`; the size does not. `text-lg font-semibold`
            stays pinned at every level, because how deeply the host nests this pane and
            how heavy its title should look are independent decisions — re-coupling them
            is how the level ended up hardcoded in the first place (WIC-1417).
            No emoji, deliberately, despite the sibling "📝 Editor": §10 keeps icons in
            this family decorative and `aria-hidden`, and an emoji inside heading *text* is
            the one place that cannot be done — it would announce as "memo Cover Letter
            Preview". The fix direction is stripping the editor's, not matching it. */}
        <Heading className="text-lg font-semibold text-gray-900">Cover Letter Preview</Heading>
        {showExportActions && (
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                copyStatus === 'copied'
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
              disabled={copyStatus === 'copied'}
            >
              {copyStatus === 'copied' ? '✓ Copied!' : '📋 Copy'}
            </button>
            {onDownload && (
              <button
                onClick={() => onDownload('docx')}
                disabled={isExporting}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400 disabled:cursor-not-allowed"
              >
                {isExporting ? 'Exporting...' : '⬇ Download DOCX'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Preview Content */}
      <div className="flex-1 overflow-auto bg-white p-8">
        <div className="max-w-3xl mx-auto">
          <div
            className="cover-letter-preview"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: '11pt',
              lineHeight: '1.6',
              color: '#1a1a1a',
            }}
          >
            {content ? (
              formatContent()
            ) : (
              <div className="text-center text-gray-400 py-12">No content to preview</div>
            )}
          </div>
        </div>
      </div>

      {/* Footer Stats */}
      {(wordCount || variant) && (
        <div className="px-8 py-4 border-t bg-gray-50 text-sm text-gray-600">
          <div className="max-w-3xl mx-auto flex items-center gap-4">
            {wordCount && (
              <span className="flex items-center gap-2">📊 {calculatedWordCount} words</span>
            )}
            {variant && (
              <>
                <span>•</span>
                <span className="capitalize">{variant.tone} tone</span>
                <span>•</span>
                <span className="capitalize">{variant.length} length</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
