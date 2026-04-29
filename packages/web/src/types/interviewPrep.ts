export type InterviewType = 'behavioral' | 'technical' | 'mixed' | 'case_study';
export type PrepTime = '30min' | '1hr' | '2hr' | 'full_day';
export type ConfidenceLevel = 'not_practiced' | 'needs_work' | 'comfortable' | 'confident';
export type QuestionCategory = 'behavioral' | 'technical' | 'situational' | 'role_specific' | 'gap_probing';
export type QuestionDifficulty = 'standard' | 'challenging' | 'tough';
export type GapSeverity = 'critical' | 'moderate' | 'minor';
export type MitigationStrategy = 'acknowledgePivot' | 'growthMindset' | 'adjacentExperience';
export type ExportFormat = 'pdf' | 'markdown' | 'print';

export interface PrepStory {
  id: string;
  starEntryId: string;
  themes: string[];
  relevanceScore: number;
  oneMinVersion: string;
  twoMinVersion: string;
  fiveMinVersion: string;
  isFavorite: boolean;
  personalNotes?: string;
  practiceCount: number;
  lastPracticedAt?: string;
  confidenceLevel: ConfidenceLevel;
  displayOrder: number;
}

export interface GeneratedQuestion {
  id: string;
  text: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  whyTheyAsk: string;
  whatTheyWant: string;
  answerFramework: string;
  suggestedStoryIds: string[];
  linkedStoryId?: string;
  personalNotes?: string;
  practiceStatus: ConfidenceLevel;
  lastPracticedAt?: string;
}

export interface TalkingPoint {
  title: string;
  script: string;
  keyPhrases: string[];
  redirectToStrength: string;
}

export interface GapMitigation {
  id: string;
  skill: string;
  severity: GapSeverity;
  description: string;
  whyItMatters: string;
  strategies: {
    acknowledgePivot: TalkingPoint;
    growthMindset: TalkingPoint;
    adjacentExperience: TalkingPoint;
  };
  relatedStoryIds: string[];
  selectedStrategy?: MitigationStrategy;
  isAddressed: boolean;
}

export interface CompanyFact {
  id: string;
  fact: string;
  source: string;
  useFor: 'mention' | 'ask_about';
}

export interface SectionConfig {
  id: 'stories' | 'questions' | 'gaps' | 'company';
  enabled: boolean;
  order: number;
  selectedItems: string[];
}

export interface QuickReference {
  sections: SectionConfig[];
  topStoryIds: string[];
  keyQuestionIds: string[];
  gapPointIds: string[];
  companyFacts: CompanyFact[];
  lastExportedAt?: string;
  exportFormat?: ExportFormat;
}

export interface PracticeSession {
  id: string;
  startedAt: string;
  endedAt?: string;
  type: 'single_question' | 'full_interview' | 'timed_responses';
  questionsAttempted: number;
  confidenceRatings: {
    needsWork: number;
    comfortable: number;
    confident: number;
  };
  focusAreas?: string[];
}

export interface InterviewPrep {
  id: string;
  applicationId: string;
  jobFitAnalysisId?: string;
  interviewType: InterviewType;
  timeAvailable: PrepTime;
  focusAreas: string[];
  completeness: number;
  stories: PrepStory[];
  questions: GeneratedQuestion[];
  gapMitigations: GapMitigation[];
  quickReference?: QuickReference;
  practiceLog: PracticeSession[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ApplicationSummary {
  id: string;
  jobTitle: string;
  company: string;
  status: string;
  interviewDate?: string;
}

export interface FitAnalysisSummary {
  id: string;
  recommendation: string;
  confidence: string;
  analysisTimestamp: string;
}

export interface GenerateInterviewPrepRequest {
  applicationId: string;
  jobFitAnalysisId?: string;
  interviewType?: InterviewType;
  timeAvailable?: PrepTime;
  focusAreas?: string[];
}

export interface GenerateInterviewPrepResponse {
  interviewPrep: InterviewPrep;
  storiesGenerated: number;
  questionsGenerated: number;
  gapsIdentified: number;
  catalogEntriesUsed: number;
  warnings: GenerationWarning[];
}

export interface GenerationWarning {
  code: string;
  message: string;
}

export interface GetInterviewPrepResponse {
  interviewPrep: InterviewPrep;
  application: ApplicationSummary;
  fitAnalysis?: FitAnalysisSummary;
}

export interface StoryUpdate {
  storyId: string;
  isFavorite?: boolean;
  personalNotes?: string;
  confidenceLevel?: ConfidenceLevel;
  displayOrder?: number;
}

export interface QuestionUpdate {
  questionId: string;
  linkedStoryId?: string | null;
  personalNotes?: string;
  practiceStatus?: ConfidenceLevel;
}

export interface GapUpdate {
  gapId: string;
  selectedStrategy?: MitigationStrategy;
  isAddressed?: boolean;
}

export interface QuickReferenceUpdate {
  sections?: SectionConfig[];
  topStoryIds?: string[];
  keyQuestionIds?: string[];
  gapPointIds?: string[];
  companyFacts?: CompanyFact[];
}

export interface UpdateInterviewPrepRequest {
  storyUpdates?: StoryUpdate[];
  questionUpdates?: QuestionUpdate[];
  gapUpdates?: GapUpdate[];
  quickReference?: QuickReferenceUpdate;
  focusAreas?: string[];
  interviewType?: InterviewType;
  timeAvailable?: PrepTime;
  version: number;
}

export interface UpdateInterviewPrepResponse {
  interviewPrep: InterviewPrep;
  completenessChange: number;
}

export interface QuestionPracticeResult {
  questionId: string;
  confidenceRating: ConfidenceLevel;
  usedStoryId?: string;
  notes?: string;
}

export interface StoryPracticeResult {
  storyId: string;
  confidenceRating: ConfidenceLevel;
  timeUsed?: number;
  notes?: string;
}

export interface GapPracticeResult {
  gapId: string;
  strategyUsed: MitigationStrategy;
  confidenceRating: ConfidenceLevel;
  notes?: string;
}

export interface LogPracticeSessionRequest {
  type: 'single_question' | 'full_interview' | 'timed_responses';
  startedAt: string;
  endedAt?: string;
  focusAreas?: string[];
  questionResults?: QuestionPracticeResult[];
  storyResults?: StoryPracticeResult[];
  gapResults?: GapPracticeResult[];
  version: number;
}

export interface LogPracticeSessionResponse {
  session: PracticeSession;
  interviewPrep: InterviewPrep;
  completenessChange: number;
  summary: {
    questionsAttempted: number;
    storiesPracticed: number;
    gapsAddressed: number;
    averageConfidence: ConfidenceLevel;
    improvementAreas: string[];
  };
}

export interface ExportQuickReferenceResponse {
  exportId: string;
  format: ExportFormat;
  filename: string;
  fileSize: number;
  base64Content: string;
  createdAt: string;
}
