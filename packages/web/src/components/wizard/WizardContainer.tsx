import { useState, useEffect, useCallback } from 'react';
import { ProgressIndicator } from './ProgressIndicator';
import { WizardStep } from './WizardStep';
import { WizardButton } from './WizardButton';
import { STARInput, type STARData } from './STARInput';
import { TechStackPicker } from './TechStackPicker';

export interface ProjectData {
  company: string;
  role: string;
  period: string;
  industry: string;
  accomplishments: AccomplishmentData[];
  jobFit: string[];
  techStack: string[];
}

export interface AccomplishmentData extends STARData {
  id: string;
  technologies?: string[];
}

export interface ProjectFile {
  filename: string;
  content: string;
  data: ProjectData;
}

export interface WizardContainerProps {
  variant: 'create' | 'enrich' | 'correct';
  existingFileId?: string;
  onComplete: (generatedFile: ProjectFile) => void;
  onCancel: () => void;
  onSaveDraft: (draftData: Partial<ProjectData>) => void;
}

const STEP_LABELS = ['Context', 'Details', 'Industry', 'Accomplishments', 'Tags'];

/**
 * WizardContainer Component
 * Main wizard controller for dialogue-based STAR file capture
 */
export function WizardContainer({
  variant,
  onComplete,
  onCancel,
  onSaveDraft,
}: WizardContainerProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<Partial<ProjectData>>({
    accomplishments: [],
    jobFit: [],
    techStack: [],
  });
  const [currentSTAR, setCurrentSTAR] = useState<STARData>({
    headline: '',
    situation: '',
    task: '',
    action: '',
    result: '',
  });
  const [currentTech, setCurrentTech] = useState<string[]>([]);
  const totalSteps = 5;

  // Auto-save draft every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (Object.keys(data).length > 0) {
        onSaveDraft(data);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [data, onSaveDraft]);

  // Manual save draft (Ctrl+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSaveDraft(data);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, onSaveDraft]);

  const handleComplete = useCallback(() => {
    // Generate filename
    const company = data.company?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
    const role = data.role?.toLowerCase().replace(/\s+/g, '-') || 'role';
    const filename = `${company}-${role}.md`;

    // Generate markdown content
    const content = generateMarkdown(data as ProjectData);

    const projectFile: ProjectFile = {
      filename,
      content,
      data: data as ProjectData,
    };

    onComplete(projectFile);
  }, [data, onComplete]);

  const handleNext = useCallback(() => {
    if (currentStep < totalSteps) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Generate and complete wizard
      handleComplete();
    }
  }, [currentStep, totalSteps, handleComplete]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleStepClick = useCallback((step: number) => {
    setCurrentStep(step);
  }, []);

  const updateData = useCallback((updates: Partial<ProjectData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  }, []);

  const addAccomplishment = useCallback(() => {
    const accomplishment: AccomplishmentData = {
      id: Date.now().toString(),
      ...currentSTAR,
      technologies: currentTech,
    };

    updateData({
      accomplishments: [...(data.accomplishments || []), accomplishment],
    });

    // Reset STAR input
    setCurrentSTAR({
      headline: '',
      situation: '',
      task: '',
      action: '',
      result: '',
    });
    setCurrentTech([]);
  }, [currentSTAR, currentTech, data.accomplishments, updateData]);

  const removeAccomplishment = useCallback((id: string) => {
    updateData({
      accomplishments: (data.accomplishments || []).filter((a) => a.id !== id),
    });
  }, [data.accomplishments, updateData]);

  // Validation for each step
  const canProceedStep1 = () => {
    return !!data.company && data.company.length >= 2;
  };

  const canProceedStep2 = () => {
    const periodRegex = /^[A-Z][a-z]{2} \d{4} - ([A-Z][a-z]{2} \d{4}|Present)$/;
    return (
      !!data.role &&
      data.role.length >= 2 &&
      !!data.period &&
      periodRegex.test(data.period)
    );
  };

  const canProceedStep3 = () => {
    return !!data.industry && data.industry.length >= 2;
  };

  const canProceedStep4 = () => {
    return (data.accomplishments?.length || 0) >= 1;
  };

  const canProceedStep5 = () => {
    return true; // Job fit is optional
  };

  const isSTARComplete = () => {
    return (
      currentSTAR.headline.length >= 10 &&
      currentSTAR.situation.length >= 10 &&
      currentSTAR.task.length >= 10 &&
      currentSTAR.action.length >= 10 &&
      currentSTAR.result.length >= 10
    );
  };

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <WizardStep
            stepNumber={1}
            totalSteps={totalSteps}
            question="What company or organization was this project with?"
            hint="Use the full company name"
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceedStep1()}
          >
            <input
              type="text"
              value={data.company || ''}
              onChange={(e) => updateData({ company: e.target.value })}
              placeholder="e.g., Acme Corporation"
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all duration-base"
              autoFocus
              maxLength={100}
            />
          </WizardStep>
        );

      case 2:
        return (
          <WizardStep
            stepNumber={2}
            totalSteps={totalSteps}
            question="What was your role and time period?"
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceedStep2()}
          >
            <div className="space-y-6">
              <div>
                <label htmlFor="role" className="block text-body font-medium text-neutral-800 mb-2">
                  Role or Title
                </label>
                <input
                  id="role"
                  type="text"
                  value={data.role || ''}
                  onChange={(e) => updateData({ role: e.target.value })}
                  placeholder="e.g., Senior Software Engineer"
                  className="w-full px-4 py-3 border border-neutral-300 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all duration-base"
                  maxLength={100}
                />
              </div>

              <div>
                <label htmlFor="period" className="block text-body font-medium text-neutral-800 mb-2">
                  Time Period
                </label>
                <input
                  id="period"
                  type="text"
                  value={data.period || ''}
                  onChange={(e) => updateData({ period: e.target.value })}
                  placeholder="Jan 2023 - Present"
                  className="w-full px-4 py-3 border border-neutral-300 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all duration-base"
                />
                <p className="mt-2 text-body-sm text-neutral-600">
                  Format: 'Mon YYYY - Mon YYYY' or 'Mon YYYY - Present'
                </p>
              </div>
            </div>
          </WizardStep>
        );

      case 3:
        return (
          <WizardStep
            stepNumber={3}
            totalSteps={totalSteps}
            question="What industry or sector?"
            hint="e.g., 'FinTech', 'Healthcare', 'E-commerce'"
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceedStep3()}
          >
            <input
              type="text"
              value={data.industry || ''}
              onChange={(e) => updateData({ industry: e.target.value })}
              placeholder="Enter the industry name (no autocomplete)"
              className="w-full px-4 py-3 border border-neutral-300 rounded-lg text-body focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all duration-base"
              maxLength={50}
            />
          </WizardStep>
        );

      case 4:
        return (
          <WizardStep
            stepNumber={4}
            totalSteps={totalSteps}
            question="Tell me about your key accomplishments"
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceedStep4()}
          >
            <div className="space-y-6">
              {/* STAR Input Form */}
              <STARInput value={currentSTAR} onChange={setCurrentSTAR} />

              {/* Technologies for this accomplishment */}
              <div>
                <label className="block text-body font-medium text-neutral-800 mb-2">
                  Technologies used (optional)
                </label>
                <TechStackPicker value={currentTech} onChange={setCurrentTech} />
              </div>

              {/* Add Accomplishment Button */}
              <WizardButton
                variant="primary"
                onClick={addAccomplishment}
                disabled={!isSTARComplete()}
              >
                + Save This Accomplishment
              </WizardButton>

              {/* Saved Accomplishments */}
              {(data.accomplishments?.length || 0) > 0 && (
                <div className="mt-6 space-y-3">
                  <h3 className="text-h4 text-neutral-800">
                    Saved Accomplishments ({data.accomplishments?.length})
                  </h3>
                  {data.accomplishments?.map((acc) => (
                    <div
                      key={acc.id}
                      className="p-4 bg-neutral-50 border border-neutral-200 rounded-lg"
                    >
                      <div className="flex items-start justify-between">
                        <p className="text-body font-medium text-neutral-800">{acc.headline}</p>
                        <button
                          type="button"
                          onClick={() => removeAccomplishment(acc.id)}
                          className="text-error-700 hover:text-error-900 text-body-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </WizardStep>
        );

      case 5:
        return (
          <WizardStep
            stepNumber={5}
            totalSteps={totalSteps}
            question="What types of roles would this project be relevant for?"
            hint="Enter job fit categories (comma-separated or press Enter). You can skip this if unsure."
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceedStep5()}
            nextLabel="Preview"
          >
            <TechStackPicker
              value={data.jobFit || []}
              onChange={(tags) => updateData({ jobFit: tags })}
              placeholder="e.g., backend, fullstack, devops (or type 'skip')"
            />
          </WizardStep>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 z-modal flex items-center justify-center p-4"
      role="dialog"
      aria-labelledby="wizard-title"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-8 py-6 border-b border-neutral-200">
          <div className="flex items-center justify-between mb-4">
            <h1 id="wizard-title" className="text-h2 text-neutral-900">
              {variant === 'create' && 'New Project'}
              {variant === 'enrich' && 'Enrich Project'}
              {variant === 'correct' && 'Correct Project'}
            </h1>
            <div className="flex items-center gap-3">
              <WizardButton
                variant="ghost"
                onClick={() => onSaveDraft(data)}
              >
                Save Draft
              </WizardButton>
              <button
                type="button"
                onClick={onCancel}
                className="text-neutral-600 hover:text-neutral-800 text-h3"
                aria-label="Close wizard"
              >
                ×
              </button>
            </div>
          </div>

          {/* Progress Indicator */}
          <ProgressIndicator
            currentStep={currentStep}
            totalSteps={totalSteps}
            stepLabels={STEP_LABELS}
            onStepClick={handleStepClick}
          />
        </div>

        {/* Step Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {renderStepContent()}
        </div>
      </div>
    </div>
  );
}

// Helper function to generate markdown from project data
function generateMarkdown(data: ProjectData): string {
  const frontmatter = `---
company: ${data.company}
role: ${data.role}
period: ${data.period}
industry: ${data.industry}
tech_stack:
${data.techStack?.map((tech) => `  - ${tech}`).join('\n') || '  []'}
job_fit:
${data.jobFit?.map((fit) => `  - ${fit}`).join('\n') || '  []'}
---

`;

  const accomplishments = data.accomplishments
    ?.map((acc) => {
      return `### ${acc.headline}

**Situation:** ${acc.situation}

**Task:** ${acc.task}

**Action:** ${acc.action}

**Result:** ${acc.result}
${acc.technologies && acc.technologies.length > 0 ? `\n**Technologies:** ${acc.technologies.join(', ')}` : ''}
`;
    })
    .join('\n\n');

  return `${frontmatter}## Accomplishments\n\n${accomplishments}`;
}
