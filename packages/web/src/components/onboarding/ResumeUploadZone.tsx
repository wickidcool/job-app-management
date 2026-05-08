import { useCallback, useRef, useState } from 'react';
import { resumeService } from '../../services/api';
import type { Resume } from '../../services/api';

interface UploadError {
  code: 'INVALID_FORMAT' | 'FILE_TOO_LARGE' | 'UPLOAD_FAILED';
  message: string;
}

interface ResumeUploadZoneProps {
  onUploadSuccess: (resume: Resume) => void;
  onUploadError: (error: UploadError) => void;
  acceptedFormats?: string[];
  maxSizeBytes?: number;
  showFormatHints?: boolean;
}

const DEFAULT_ACCEPTED_FORMATS = ['.pdf', '.docx'];
const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export function ResumeUploadZone({
  onUploadSuccess,
  onUploadError,
  acceptedFormats = DEFAULT_ACCEPTED_FORMATS,
  maxSizeBytes = DEFAULT_MAX_SIZE_BYTES,
  showFormatHints = true,
}: ResumeUploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedResume, setUploadedResume] = useState<Resume | null>(null);
  const [error, setError] = useState<UploadError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): UploadError | null => {
    // Check file type
    const fileExt = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedFormats.includes(fileExt)) {
      return {
        code: 'INVALID_FORMAT',
        message: `File type not supported. Please upload ${acceptedFormats.join(' or ')} files.`,
      };
    }

    // Check file size
    if (file.size > maxSizeBytes) {
      const sizeMB = (maxSizeBytes / (1024 * 1024)).toFixed(0);
      return {
        code: 'FILE_TOO_LARGE',
        message: `File is too large. Maximum size is ${sizeMB}MB.`,
      };
    }

    // Check minimum size (1KB to avoid empty files)
    if (file.size < 1024) {
      return {
        code: 'FILE_TOO_LARGE',
        message: 'File is too small. Please upload a valid resume.',
      };
    }

    return null;
  };

  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        onUploadError(validationError);
        return;
      }

      setError(null);
      setIsUploading(true);
      setUploadProgress(0);

      try {
        // Simulate upload progress for better UX
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 10, 90));
        }, 200);

        const resume = await resumeService.upload(file);

        clearInterval(progressInterval);
        setUploadProgress(100);
        setUploadedResume(resume);
        onUploadSuccess(resume);
      } catch (err) {
        const uploadError: UploadError = {
          code: 'UPLOAD_FAILED',
          message: err instanceof Error ? err.message : 'Upload failed. Please try again.',
        };
        setError(uploadError);
        onUploadError(uploadError);
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadSuccess, onUploadError, maxSizeBytes, acceptedFormats]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        void uploadFile(files[0]);
      }
    },
    [uploadFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        void uploadFile(files[0]);
      }
    },
    [uploadFile]
  );

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const handleChangeFile = () => {
    setUploadedResume(null);
    setError(null);
    fileInputRef.current?.click();
  };

  const handleTryAgain = () => {
    setError(null);
    fileInputRef.current?.click();
  };

  // Success state
  if (uploadedResume) {
    return (
      <div className="rounded-lg border-2 border-success-300 bg-success-50 p-6 text-center">
        <div className="mb-3 flex justify-center">
          <svg className="h-12 w-12 text-success-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold text-success-900">Resume uploaded!</p>
        <p className="mt-1 text-sm text-success-700">
          {uploadedResume.fileName} ({(uploadedResume.fileSize / 1024).toFixed(1)} KB)
        </p>
        <button
          type="button"
          onClick={handleChangeFile}
          className="mt-4 rounded-md bg-white px-4 py-2 text-sm font-medium text-success-700 shadow-sm ring-1 ring-inset ring-success-300 hover:bg-success-50"
        >
          Change File
        </button>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg border-2 border-error-500 bg-error-50 p-6 text-center">
        <div className="mb-3 flex justify-center">
          <svg className="h-12 w-12 text-error-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold text-error-900">Upload failed</p>
        <p className="mt-1 text-sm text-error-700">{error.message}</p>
        <button
          type="button"
          onClick={handleTryAgain}
          className="mt-4 rounded-md bg-error-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-error-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Uploading state
  if (isUploading) {
    return (
      <div className="rounded-lg border-2 border-primary-300 bg-primary-50 p-6 text-center">
        <div className="mb-3 flex justify-center">
          <svg
            className="h-12 w-12 animate-spin text-primary-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold text-primary-900">Uploading...</p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-primary-200">
          <div
            className="h-full bg-primary-600 transition-all duration-300"
            style={{ width: `${uploadProgress}%` }}
          />
        </div>
        <p className="mt-2 text-sm text-primary-700">{uploadProgress}%</p>
      </div>
    );
  }

  // Idle state (drag-and-drop zone)
  return (
    <div
      className={`relative cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-all ${
        isDragOver
          ? 'border-primary-500 bg-primary-50'
          : 'border-neutral-300 bg-neutral-50 hover:border-neutral-400 hover:bg-neutral-100'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label="Upload resume: Drag and drop or click to browse"
      aria-describedby="upload-hint"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFormats.join(',')}
        onChange={handleFileSelect}
        className="hidden"
        aria-hidden="true"
      />

      <div className="mb-3 flex justify-center">
        {isDragOver ? (
          <svg className="h-16 w-16 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
            />
          </svg>
        ) : (
          <svg className="h-16 w-16 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        )}
      </div>

      {isDragOver ? (
        <>
          <p className="text-lg font-medium text-primary-900">Drop your resume here</p>
        </>
      ) : (
        <>
          <p className="text-lg font-medium text-neutral-900">Drag & drop your resume</p>
          <p className="mt-1 text-sm text-neutral-600">or click to browse</p>
        </>
      )}

      {showFormatHints && (
        <p id="upload-hint" className="mt-4 text-xs text-neutral-500">
          Accepts: {acceptedFormats.join(', ').toUpperCase()} (max {(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB)
        </p>
      )}
    </div>
  );
}
