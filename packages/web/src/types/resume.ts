/**
 * Resume types for upload, parsing, and export functionality
 */

export interface STARBullet {
  situation: string;
  task: string;
  action: string;
  result: string;
  originalText: string;
}

export interface STARExperience {
  id: string;
  company: string;
  role: string;
  startDate: Date;
  endDate?: Date;
  bullets: STARBullet[];
}

export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startDate: Date;
  endDate?: Date;
  gpa?: string;
}

export interface ParsedResume {
  id: string;
  fileName: string;
  uploadedAt: Date;
  parsedExperiences: STARExperience[];
  education: Education[];
  skills: string[];
}

export type ExportFormat = 'markdown' | 'pdf' | 'docx';

export interface ResumeExport {
  id: string;
  name: string;
  createdAt: Date;
  linkedApplicationId?: string;
  linkedApplicationTitle?: string;
  experienceIds: string[];
  format: ExportFormat;
  fileSize: number;
}

export type UploadState = 'empty' | 'uploading' | 'processing' | 'complete' | 'error';

export interface UploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  percentage: number;
}
