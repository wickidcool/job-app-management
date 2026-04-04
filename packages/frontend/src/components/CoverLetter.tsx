interface Props {
  coverLetter: string;
  copied: boolean;
  onCopy: () => void;
}

export default function CoverLetter({ coverLetter, copied, onCopy }: Props) {
  if (!coverLetter) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3>Cover Letter</h3>
        <button onClick={onCopy}>{copied ? 'Copied!' : 'Copy to Clipboard'}</button>
      </div>
      <textarea
        readOnly
        value={coverLetter}
        rows={20}
        style={{ width: '100%', fontFamily: 'serif', lineHeight: '1.6' }}
      />
    </div>
  );
}
