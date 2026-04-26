import { useState } from 'react';
import type { OutreachPlatform, OutreachMessage } from '../services/api/types';
import { useGenerateOutreach } from '../hooks/useCoverLetters';

interface OutreachComposerProps {
  platform: OutreachPlatform;
  fitAnalysisId?: string;
  prefillContext?: {
    company: string;
    jobTitle: string;
    hiringManager?: string;
  };
  onComplete?: (result: OutreachMessage) => void;
}

const PLATFORM_LIMITS = {
  linkedin: {
    maxChars: 1900,
    recommendedMax: 300,
    hasSubject: false,
    name: 'LinkedIn InMail',
  },
  email: {
    maxChars: null,
    recommendedMax: 500,
    hasSubject: true,
    subjectMaxChars: 78,
    name: 'Email',
  },
};

export function OutreachComposer({
  platform: initialPlatform,
  fitAnalysisId,
  prefillContext,
  onComplete,
}: OutreachComposerProps) {
  const [platform, setPlatform] = useState<OutreachPlatform>(initialPlatform);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [company, setCompany] = useState(prefillContext?.company || '');
  const [jobTitle, setJobTitle] = useState(prefillContext?.jobTitle || '');
  const [contact, setContact] = useState(prefillContext?.hiringManager || '');
  const [useFitAnalysis, setUseFitAnalysis] = useState(!!fitAnalysisId);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const generateMutation = useGenerateOutreach();

  const limits = PLATFORM_LIMITS[platform];
  const bodyCharCount = body.length;
  const subjectCharCount = subject.length;

  const getBodyStatus = () => {
    if (!limits.maxChars && !limits.recommendedMax) return 'good';
    const recommended = limits.recommendedMax;

    if (limits.maxChars && bodyCharCount > limits.maxChars) return 'error';
    if (recommended && bodyCharCount > recommended) return 'warning';
    return 'good';
  };

  const getSubjectStatus = () => {
    if (!limits.hasSubject) return 'good';
    if (platform === 'email') {
      const emailLimits = PLATFORM_LIMITS.email;
      if (subjectCharCount > emailLimits.subjectMaxChars) return 'warning';
    }
    return 'good';
  };

  const bodyStatus = getBodyStatus();
  const subjectStatus = getSubjectStatus();

  const handleGenerate = async () => {
    try {
      const result = await generateMutation.mutateAsync({
        platform,
        targetCompany: company,
        targetRole: jobTitle,
        targetName: contact,
        jobFitAnalysisId: useFitAnalysis ? fitAnalysisId : undefined,
      });

      setBody(result.body);
      if (limits.hasSubject && result.subject) {
        setSubject(result.subject);
      }
    } catch (error) {
      console.error('Generation failed:', error);
    }
  };

  const handleCopy = async () => {
    try {
      const textToCopy = limits.hasSubject ? `${subject}\n\n${body}` : body;
      await navigator.clipboard.writeText(textToCopy);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleSave = () => {
    const result: OutreachMessage = {
      platform,
      subject: limits.hasSubject ? subject : undefined,
      body,
      characterCount: bodyCharCount,
      generatedAt: new Date().toISOString(),
    };
    onComplete?.(result);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="bg-white border rounded-lg p-6 space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Compose Outreach Message</h2>

        {/* Platform Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Platform</label>
          <div className="flex gap-3">
            {(['linkedin', 'email'] as OutreachPlatform[]).map((p) => (
              <label
                key={p}
                className="flex items-center gap-2 px-4 py-2 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <input
                  type="radio"
                  checked={platform === p}
                  onChange={() => setPlatform(p)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="font-medium capitalize">{PLATFORM_LIMITS[p].name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Context */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-gray-900">Context</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Company</label>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="TechCorp Inc."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Senior Full Stack Engineer"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contact</label>
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Jane Smith, Engineering Manager"
              />
            </div>
            {fitAnalysisId && (
              <div className="flex items-center">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useFitAnalysis}
                    onChange={(e) => setUseFitAnalysis(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <span>Use fit analysis highlights</span>
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Generate Button */}
        {!body && (
          <button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || !company || !jobTitle}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate Message'}
          </button>
        )}

        {/* Subject (Email only) */}
        {body && limits.hasSubject && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Line</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Your subject line..."
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span
                className={
                  subjectStatus === 'warning' ? 'text-yellow-600' : 'text-gray-500'
                }
              >
                {subjectCharCount} / {platform === 'email' ? PLATFORM_LIMITS.email.subjectMaxChars : 100} characters
              </span>
              {subjectStatus === 'good' && <span className="text-green-600">✅ Good</span>}
              {subjectStatus === 'warning' && (
                <span className="text-yellow-600">⚠️ Consider shortening</span>
              )}
            </div>
          </div>
        )}

        {/* Message Body */}
        {body && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {limits.hasSubject ? 'Body' : 'Message'}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={10}
              placeholder="Your message..."
            />

            {/* Character Counter */}
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4">
                  <span
                    className={
                      bodyStatus === 'error'
                        ? 'text-red-600 font-semibold'
                        : bodyStatus === 'warning'
                          ? 'text-yellow-600'
                          : 'text-gray-600'
                    }
                  >
                    {bodyCharCount}{' '}
                    {limits.recommendedMax &&
                      `/ ${limits.recommendedMax} recommended`}
                    {limits.maxChars && ` (${limits.maxChars} max)`}
                  </span>
                  {bodyStatus === 'good' && (
                    <span className="text-green-600 text-xs">✅ Good length</span>
                  )}
                  {bodyStatus === 'warning' && (
                    <span className="text-yellow-600 text-xs">
                      ⚠️ Consider shortening for mobile readers
                    </span>
                  )}
                  {bodyStatus === 'error' && (
                    <span className="text-red-600 text-xs">
                      ❌ Exceeds maximum length
                    </span>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    bodyStatus === 'error'
                      ? 'bg-red-600'
                      : bodyStatus === 'warning'
                        ? 'bg-yellow-500'
                        : 'bg-green-600'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      (bodyCharCount / (limits.recommendedMax || limits.maxChars || 500)) * 100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Quality Indicators */}
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <span className="flex items-center gap-1 text-green-600">
                <span>✅</span>
                <span>Specific</span>
              </span>
              <span className="flex items-center gap-1 text-green-600">
                <span>✅</span>
                <span>Clear CTA</span>
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        {body && (
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Regenerate
            </button>
            <button
              onClick={() => setBody('')}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleCopy}
              className={`px-6 py-2 rounded-lg transition-colors ${
                copyStatus === 'copied'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copyStatus === 'copied' ? '✓ Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleSave}
              disabled={bodyStatus === 'error'}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex-1"
            >
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
