import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParsedResume, UploadState, UploadProgress } from '../types/resume';

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

  const validateFile = (file: File): string | null => {
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
  };

  const uploadFile = async (file: File) => {
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
        }
      });

      xhr.addEventListener('load', () => {
        console.log('[ResumeUpload] XHR load event fired, status:', xhr.status);
        if (xhr.status >= 200 && xhr.status < 300) {
          // Ensure uploading state is visible for at least 500ms
          const MIN_UPLOAD_DISPLAY_MS = 500;
          const elapsedTime = Date.now() - uploadStartTimeRef.current;
          const remainingTime = Math.max(0, MIN_UPLOAD_DISPLAY_MS - elapsedTime);

          console.log('[ResumeUpload] Upload elapsed time:', elapsedTime, 'ms, waiting', remainingTime, 'ms more');

          setTimeout(() => {
            console.log('[ResumeUpload] Setting uploadState to processing');
            setUploadState('processing');

            const response = JSON.parse(xhr.responseText);
            const parsed: ParsedResume = {
              id: response.id,
              fileName: file.name,
              uploadedAt: new Date(response.uploadedAt),
              parsedExperiences: response.experiences || [],
              education: response.education || [],
              skills: response.skills || [],
            };

            setParsedData(parsed);
            setUploadState('complete');
            onUploadComplete(response.id, parsed);
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

      xhr.open('POST', '/api/resumes/upload');
      xhr.send(formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setErrorMessage(message);
      setUploadState('error');
      onUploadError(error instanceof Error ? error : new Error(message));
    }
  };

  const handleFileSelect = useCallback(
    (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setErrorMessage(validationError);
        setUploadState('error');
        return;
      }

      uploadFile(file);
    },
    [maxFileSizeMB, acceptedFormats]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const files = e.dataTransfer.files;
      if (files && files[0]) {
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
    setParsedData(null);
    setUploadState('empty');
    setFileName('');
  }, []);

  const formatFileSize = (bytes: number): string => {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFormats.join(',')}
        onChange={handleFileInputChange}
        className="hidden"
      />

      {uploadState === 'empty' && (
        <div
          role="region"
          aria-label="Resume upload area"
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
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
          <div className="text-sm text-neutral-600 mb-2">or click to browse</div>
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
            />
          </div>

          <div className="text-sm text-neutral-600">
            {formatFileSize(progress.bytesUploaded)} / {formatFileSize(progress.totalBytes)} ({progress.percentage}%)
          </div>
        </div>
      )}

      {uploadState === 'processing' && (
        <div className="border border-neutral-200 rounded-lg p-8 text-center">
          <div className="text-4xl mb-4 animate-spin inline-block">🔄</div>
          <div className="text-lg font-medium text-neutral-900 mb-4">
            Analyzing resume...
          </div>
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
            <button className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
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
