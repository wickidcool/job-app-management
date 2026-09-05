import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParsedResume, UploadState, UploadProgress } from '../types/resume';
import { apiClient } from '../services/api';
import { track, getSessionId } from '../services/analytics';

interface ResumeUploadProps {
  onUploadComplete: (resumeId: string, parsedData: ParsedResume) => void;
  onUploadError: (error: Error) => void;
  maxFileSizeMB?: number;
  acceptedFormats?: string[];
  existingResumeId?: string;
}

const DEFAULT_MAX_SIZE_MB = 10;
const DEFAULT_ACCEPTED_FORMATS = ['.pdf', '.docx', '.txt'];
const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export function ResumeUpload({
  onUploadComplete,
  onUploadError,
  maxFileSizeMB = DEFAULT_MAX_SIZE_MB,
  acceptedFormats = DEFAULT_ACCEPTED_FORMATS,
}: ResumeUploadProps) {
  const [uploadState, setUploadState] = useState<UploadState>('empty');
  const [progress, setProgress] = useState<UploadProgress>({
    bytesUploaded: 0,
    totalBytes: 0,
    percentage: 0,
  });
  const [fileName, setFileName] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [dragActive, setDragActive] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedResume | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadStartTimeRef = useRef<number>(0);

  useEffect(() => {
    console.log('[ResumeUpload] uploadState changed to:', uploadState);
  }, [uploadState]);

  const validateFile = useCallback(
    (file: File): string | null => {
      // Check file size
      const maxBytes = maxFileSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        return `File must be under ${maxFileSizeMB}MB`;
      }

      // Check file type
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      if (!acceptedFormats.includes(fileExtension) && !ACCEPTED_MIME_TYPES.includes(file.type)) {
        return `Please upload ${acceptedFormats.join(', ')} files`;
      }

      return null;
    },
    [maxFileSizeMB, acceptedFormats]
  );

  const uploadFile = useCallback(
    async (file: File) => {
      console.log('[ResumeUpload] Starting upload for file:', file.name);
      setFileName(file.name);
      console.log('[ResumeUpload] Setting uploadState to uploading');
      setUploadState('uploading');
      setProgress({ bytesUploaded: 0, totalBytes: file.size, percentage: 0 });
      uploadStartTimeRef.current = Date.now();

      const formData = new FormData();
      formData.append('file', file);

      abortControllerRef.current = new AbortController();

      try {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentage = Math.round((e.loaded / e.total) * 100);
            console.log('[ResumeUpload] Upload progress:', percentage + '%');
            setProgress({
              bytesUploaded: e.loaded,
              totalBytes: e.total,
              percentage,
            });

            // Transition to processing state when upload reaches 100%
            if (percentage === 100) {
              console.log('[ResumeUpload] Upload complete, transitioning to processing state');
              setUploadState('processing');
            }
          }
        });

        xhr.addEventListener('load', () => {
          console.log('[ResumeUpload] XHR load event fired, status:', xhr.status);
          if (xhr.status >= 200 && xhr.status < 300) {
            // Ensure processing state is visible for at least 800ms
            const MIN_PROCESSING_DISPLAY_MS = 800;
            const elapsedTime = Date.now() - uploadStartTimeRef.current;
            const remainingTime = Math.max(0, MIN_PROCESSING_DISPLAY_MS - elapsedTime);

            console.log(
              '[ResumeUpload] Processing complete, elapsed time:',
              elapsedTime,
              'ms, waiting',
              remainingTime,
              'ms more'
            );

            setTimeout(() => {
              const response = JSON.parse(xhr.responseText);
              // API returns { resume: { id, uploadedAt, ... }, experiences: [...], ... }
              const resumeId = response.resume?.id ?? response.id;
              const uploadedAt = response.resume?.uploadedAt ?? response.uploadedAt;
              console.log('[ResumeUpload] Upload response debug:', {
                resumeId,
                experienceCount: (response.experiences || []).length,
                parseDebug: response.parseDebug,
              });
              const parsed: ParsedResume = {
                id: resumeId,
                fileName: file.name,
                uploadedAt: new Date(uploadedAt),
                parsedExperiences: response.experiences || [],
                education: response.education || [],
                skills: response.skills || [],
              };

              setParsedData(parsed);
              console.log('[ResumeUpload] Setting uploadState to complete');
              setUploadState('complete');
              onUploadComplete(resumeId, parsed);
            }, remainingTime);
          } else {
            throw new Error(`Upload failed with status ${xhr.status}`);
          }
        });

        xhr.addEventListener('error', () => {
          throw new Error('Upload failed. Check your connection.');
        });

        xhr.addEventListener('abort', () => {
          setUploadState('empty');
          setFileName('');
        });

        const token = await apiClient.config.getAuthToken();
        xhr.open('POST', `${apiClient.config.baseURL}/resumes/upload`);
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        // Correlate this client upload with the server-side
        // resume_upload_submitted/completed/failed events (WIC-814): the backend
        // reads X-Session-Id and stamps it onto those events.
        xhr.setRequestHeader('X-Session-Id', getSessionId());
        xhr.send(formData);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed';
        setErrorMessage(message);
        setUploadState('error');
        onUploadError(error instanceof Error ? error : new Error(message));
      }
    },
    [onUploadComplete, onUploadError]
  );

  const handleFileSelect = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        // Classify the rejection reason for analytics: size is checked first in
        // validateFile, so an over-limit file reports size_exceeded regardless of
        // its type; everything else that fails is an unsupported type.
        const maxBytes = maxFileSizeMB * 1024 * 1024;
        const errorType = file.size > maxBytes ? 'size_exceeded' : 'invalid_type';
        track('resume_upload_validation_failed', {
          error_type: errorType,
          file_mime_type: file.type,
          file_size_bytes: file.size,
        });
        setErrorMessage(validationError);
        setUploadState('error');
        return;
      }

      uploadFile(file);
    },
    [validateFile, uploadFile, maxFileSizeMB]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const files = e.dataTransfer.files;
      if (files && files[0]) {
        track('resume_upload_started', { source: 'drag_drop' });
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files[0]) {
        track('resume_upload_started', { source: 'file_picker' });
        handleFileSelect(files[0]);
      }
    },
    [handleFileSelect]
  );

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setUploadState('empty');
    setFileName('');
  }, []);

  const handleRetry = useCallback(() => {
    setUploadState('empty');
    setErrorMessage('');
  }, []);

  const handleUploadNew = useCallback(() => {
    if (parsedData) {
      track('resume_upload_cta_clicked', { resume_id: parsedData.id, cta: 'upload_new' });
    }
    setParsedData(null);
    setUploadState('empty');
    setFileName('');
  }, [parsedData]);

  const handleViewDetails = useCallback(() => {
    if (parsedData) {
      track('resume_upload_cta_clicked', { resume_id: parsedData.id, cta: 'view_details' });
    }
  }, [parsedData]);

  const formatFileSize = (bytes: number): string => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full">
      {/* Driven by the drop zone / "Choose File" button rather than shown directly, but it is
          still a real form control in the accessibility tree, so it needs its own name. */}
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Choose a resume file to upload"
        accept={acceptedFormats.join(',')}
        onChange={handleFileInputChange}
        className="hidden"
      />

      {uploadState === 'empty' && (
        // The drop zone keeps the drag handlers and stays the drop target; it is no longer
        // the CONTROL. It used to carry `onClick={handleClick}` as the only pointer path to
        // the file picker, with the `<input type="file">` above `className="hidden"` and the
        // copy below promising a "click to browse" affordance that existed as no control at
        // all — so there was no keyboard path to uploading a resume. That is WCAG 2.1.1, not
        // a lint artifact, and `jsx-a11y` recorded it as `click-events-have-key-events` +
        // `no-noninteractive-element-interactions` (WIC-2077). Activation now hangs off the
        // real button below.
        //
        // Pointer users lose the whole-zone click target and must press the button. The same
        // trade was made and documented for `StarEntryPicker` (WIC-2073): the large target
        // was keyboard-unreachable, so it was never part of the accessible contract, but it
        // is a real change for pointer users.
        //
        // WIC-2078, reviewed exception (site 2 of 3). What remains after slice 2 is
        // `onDrop`/`onDragOver`/`onDragLeave` — the drop TARGET, not a control. A pointer
        // drag gesture has no keyboard equivalent to give it, so the accessible pattern is
        // not to make the zone operable but to provide an equivalent control beside it,
        // which is exactly what slice 2 added: the real "browse files" `<button>` below,
        // reachable by Tab and driving the same `handleClick` -> file picker.
        //
        // So this is the standard reviewed exception rather than a defect: the rule cannot
        // see the alternative path, and the two spellings that would satisfy it are both
        // wrong here — `tabIndex` on the zone adds a tab stop that does nothing when
        // activated (a keyboard user cannot drop a file onto it), and an interactive role
        // would be a lie about what the element does.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          role="region"
          aria-label="Resume upload area"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            border-2 border-dashed rounded-lg p-12 text-center
            transition-all duration-200
            ${
              dragActive
                ? 'border-primary-500 bg-primary-50'
                : 'border-neutral-300 hover:border-primary-400 hover:bg-neutral-50'
            }
          `}
        >
          <div className="text-6xl mb-4">📄</div>
          <div className="text-lg font-medium text-neutral-700 mb-2">
            Drag & drop your resume here
          </div>
          <div className="text-sm text-neutral-600 mb-2">
            or{' '}
            <button
              type="button"
              onClick={handleClick}
              className="font-medium text-primary-600 underline cursor-pointer hover:text-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 rounded"
            >
              browse files
            </button>
          </div>
          <div className="text-xs text-neutral-500">
            {acceptedFormats.join(', ').toUpperCase()} (Max {maxFileSizeMB}MB)
          </div>
        </div>
      )}

      {uploadState === 'uploading' && (
        <div className="border border-neutral-200 rounded-lg p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium text-neutral-900">{fileName}</div>
            <button
              onClick={handleCancel}
              className="text-neutral-500 hover:text-neutral-700 text-xl"
              aria-label="Cancel upload"
            >
              ✕
            </button>
          </div>

          <div className="w-full bg-neutral-200 rounded-full h-3 mb-2">
            <div
              className="bg-primary-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
              role="progressbar"
              aria-valuenow={progress.percentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Resume upload progress"
            />
          </div>

          <div className="text-sm text-neutral-600">
            {formatFileSize(progress.bytesUploaded)} / {formatFileSize(progress.totalBytes)} (
            {progress.percentage}%)
          </div>
        </div>
      )}

      {uploadState === 'processing' && (
        <div className="border border-neutral-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-4 animate-spin inline-block">🔄</div>
          <div className="text-lg font-medium text-neutral-900 mb-4">Analyzing resume...</div>
          <div className="text-sm text-neutral-600 space-y-1">
            <div>Extracting work experience</div>
            <div>Identifying STAR accomplishments</div>
          </div>
        </div>
      )}

      {uploadState === 'complete' && parsedData && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-6">
          <div className="flex items-center gap-2 text-green-700 font-medium mb-4">
            <span className="text-2xl">✅</span>
            <span>Resume parsed successfully!</span>
          </div>

          <div className="space-y-2 mb-6 text-neutral-700">
            <div className="flex items-center gap-2">
              <span className="text-xl">📊</span>
              <span>{parsedData.parsedExperiences.length} work experiences</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🎓</span>
              <span>{parsedData.education.length} education entries</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">💼</span>
              <span>{parsedData.skills.length} skills identified</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleViewDetails}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              View Details
            </button>
            <button
              onClick={handleUploadNew}
              className="px-4 py-2 border border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors"
            >
              Upload New
            </button>
          </div>
        </div>
      )}

      {uploadState === 'error' && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-6" role="alert">
          <div className="flex items-center gap-2 text-red-700 font-medium mb-3">
            <span className="text-2xl">⚠️</span>
            <span>Upload Failed</span>
          </div>
          <div className="text-sm text-red-600 mb-4">{errorMessage}</div>
          <div className="flex gap-3">
            <button
              onClick={handleRetry}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={handleRetry}
              className="px-4 py-2 border border-neutral-300 text-neutral-700 rounded-lg hover:bg-neutral-50 transition-colors"
            >
              Upload Different File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
