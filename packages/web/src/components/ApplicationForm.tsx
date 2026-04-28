import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as Dialog from '@radix-ui/react-dialog';
import { z } from 'zod';
import type { Application, ApplicationFormData, ApplicationStatus } from '../types/application';
import { useEffect } from 'react';

// Zod validation schema based on component specs
const applicationFormSchema = z.object({
  jobTitle: z
    .string()
    .min(2, 'Job title must be at least 2 characters')
    .max(200, 'Job title must be less than 200 characters'),
  company: z
    .string()
    .min(2, 'Company name must be at least 2 characters')
    .max(100, 'Company name must be less than 100 characters'),
  url: z
    .string()
    .regex(/^https?:\/\/.+/, 'Must be a valid URL starting with http:// or https://')
    .optional()
    .or(z.literal('')),
  location: z.string().optional(),
  salaryRange: z.string().optional(),
  jobDescription: z
    .string()
    .max(10000, 'Job description must be less than 10,000 characters')
    .optional(),
  status: z.enum([
    'saved',
    'applied',
    'phone_screen',
    'interview',
    'offer',
    'rejected',
    'withdrawn',
  ]),
  linkCoverLetter: z.boolean().optional(),
  coverLetterId: z.string().optional(),
  // UC-5 Extended Tracking Fields
  contact: z.string().max(200, 'Contact must be less than 200 characters').optional(),
  compTarget: z.string().optional(),
  nextAction: z.string().max(500, 'Next action must be less than 500 characters').optional(),
  nextActionDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format').optional().or(z.literal('')),
});

export interface ApplicationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ApplicationFormData) => Promise<void>;
  application?: Application | null;
  mode?: 'create' | 'edit';
}

export function ApplicationForm({
  open,
  onOpenChange,
  onSubmit,
  application,
  mode = 'create',
}: ApplicationFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    watch,
  } = useForm<ApplicationFormData>({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: application
      ? {
          jobTitle: application.jobTitle,
          company: application.company,
          url: application.url || '',
          location: application.location || '',
          salaryRange: application.salaryRange || '',
          jobDescription: application.jobDescription || '',
          status: application.status,
          linkCoverLetter: false,
          contact: application.contact || '',
          compTarget: application.compTarget || '',
          nextAction: application.nextAction || '',
          nextActionDue: application.nextActionDue || '',
        }
      : {
          jobTitle: '',
          company: '',
          url: '',
          location: '',
          salaryRange: '',
          jobDescription: '',
          status: 'saved' as ApplicationStatus,
          linkCoverLetter: false,
          contact: '',
          compTarget: '',
          nextAction: '',
          nextActionDue: '',
        },
  });

  const linkCoverLetter = watch('linkCoverLetter');

  // Reset form when dialog opens/closes or application changes
  useEffect(() => {
    if (open) {
      reset(
        application
          ? {
              jobTitle: application.jobTitle,
              company: application.company,
              url: application.url || '',
              location: application.location || '',
              salaryRange: application.salaryRange || '',
              jobDescription: application.jobDescription || '',
              status: application.status,
              linkCoverLetter: false,
              contact: application.contact || '',
              compTarget: application.compTarget || '',
              nextAction: application.nextAction || '',
              nextActionDue: application.nextActionDue || '',
            }
          : {
              jobTitle: '',
              company: '',
              url: '',
              location: '',
              salaryRange: '',
              jobDescription: '',
              status: 'saved' as ApplicationStatus,
              linkCoverLetter: false,
              contact: '',
              compTarget: '',
              nextAction: '',
              nextActionDue: '',
            }
      );
    }
  }, [open, application, reset]);

  const handleFormSubmit = async (data: ApplicationFormData) => {
    try {
      await onSubmit(data);
      onOpenChange(false);
    } catch (error) {
      console.error('Form submission error:', error);
    }
  };

  const handleCancel = () => {
    if (isDirty) {
      if (confirm('You have unsaved changes. Are you sure you want to discard them?')) {
        onOpenChange(false);
      }
    } else {
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 z-50"
          onKeyDown={handleKeyDown}
          aria-describedby="application-form-description"
        >
          <Dialog.Title className="text-2xl font-semibold mb-4">
            {mode === 'create' ? 'Add New Application' : 'Edit Application'}
          </Dialog.Title>

          <Dialog.Description id="application-form-description" className="sr-only">
            {mode === 'create'
              ? 'Form to add a new job application'
              : 'Form to edit an existing job application'}
          </Dialog.Description>

          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            {/* Job Title */}
            <div>
              <label htmlFor="jobTitle" className="block text-sm font-medium text-gray-700 mb-1">
                Job Title <span className="text-red-500">*</span>
              </label>
              <input
                id="jobTitle"
                type="text"
                {...register('jobTitle')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
                aria-invalid={!!errors.jobTitle}
                aria-describedby={errors.jobTitle ? 'jobTitle-error' : undefined}
              />
              {errors.jobTitle && (
                <p id="jobTitle-error" className="mt-1 text-sm text-red-600" role="alert">
                  {errors.jobTitle.message}
                </p>
              )}
            </div>

            {/* Company */}
            <div>
              <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-1">
                Company <span className="text-red-500">*</span>
              </label>
              <input
                id="company"
                type="text"
                {...register('company')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
                aria-invalid={!!errors.company}
                aria-describedby={errors.company ? 'company-error' : undefined}
              />
              {errors.company && (
                <p id="company-error" className="mt-1 text-sm text-red-600" role="alert">
                  {errors.company.message}
                </p>
              )}
            </div>

            {/* URL */}
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
                Job Posting URL
              </label>
              <input
                id="url"
                type="url"
                {...register('url')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/jobs/123"
                aria-invalid={!!errors.url}
                aria-describedby={errors.url ? 'url-error' : undefined}
              />
              {errors.url && (
                <p id="url-error" className="mt-1 text-sm text-red-600" role="alert">
                  {errors.url.message}
                </p>
              )}
            </div>

            {/* Location and Salary Range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  id="location"
                  type="text"
                  {...register('location')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Remote, NYC"
                />
              </div>

              <div>
                <label
                  htmlFor="salaryRange"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Salary Range
                </label>
                <input
                  id="salaryRange"
                  type="text"
                  {...register('salaryRange')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., $120k - $150k"
                />
              </div>
            </div>

            {/* Status */}
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                id="status"
                {...register('status')}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-required="true"
              >
                <option value="saved">Saved</option>
                <option value="applied">Applied</option>
                <option value="phone_screen">Phone Screen</option>
                <option value="interview">Interview</option>
                <option value="offer">Offer</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>

            {/* Job Description */}
            <div>
              <label
                htmlFor="jobDescription"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Job Description
              </label>
              <textarea
                id="jobDescription"
                {...register('jobDescription')}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                placeholder="Paste job description here for reference..."
                aria-invalid={!!errors.jobDescription}
                aria-describedby={errors.jobDescription ? 'jobDescription-error' : undefined}
              />
              {errors.jobDescription && (
                <p id="jobDescription-error" className="mt-1 text-sm text-red-600" role="alert">
                  {errors.jobDescription.message}
                </p>
              )}
            </div>

            {/* Extended Details Section */}
            <div className="pt-4 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Extended Tracking</h3>

              {/* Contact */}
              <div className="mb-4">
                <label htmlFor="contact" className="block text-sm font-medium text-gray-700 mb-1">
                  Contact
                </label>
                <input
                  id="contact"
                  type="text"
                  {...register('contact')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Jane Smith, Engineering Manager"
                  aria-invalid={!!errors.contact}
                  aria-describedby={errors.contact ? 'contact-error' : undefined}
                />
                {errors.contact && (
                  <p id="contact-error" className="mt-1 text-sm text-red-600" role="alert">
                    {errors.contact.message}
                  </p>
                )}
              </div>

              {/* Comp Target */}
              <div className="mb-4">
                <label htmlFor="compTarget" className="block text-sm font-medium text-gray-700 mb-1">
                  Comp Target
                </label>
                <input
                  id="compTarget"
                  type="text"
                  {...register('compTarget')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="$175k base + equity"
                  aria-invalid={!!errors.compTarget}
                  aria-describedby={errors.compTarget ? 'compTarget-error' : undefined}
                />
                <p className="mt-1 text-xs text-gray-500">Your target compensation (distinct from posted range)</p>
                {errors.compTarget && (
                  <p id="compTarget-error" className="mt-1 text-sm text-red-600" role="alert">
                    {errors.compTarget.message}
                  </p>
                )}
              </div>

              {/* Next Action and Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="nextAction" className="block text-sm font-medium text-gray-700 mb-1">
                    Next Action
                  </label>
                  <input
                    id="nextAction"
                    type="text"
                    {...register('nextAction')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Follow up with recruiter"
                    aria-invalid={!!errors.nextAction}
                    aria-describedby={errors.nextAction ? 'nextAction-error' : undefined}
                  />
                  {errors.nextAction && (
                    <p id="nextAction-error" className="mt-1 text-sm text-red-600" role="alert">
                      {errors.nextAction.message}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="nextActionDue" className="block text-sm font-medium text-gray-700 mb-1">
                    Due Date
                  </label>
                  <input
                    id="nextActionDue"
                    type="date"
                    {...register('nextActionDue')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-invalid={!!errors.nextActionDue}
                    aria-describedby={errors.nextActionDue ? 'nextActionDue-error' : undefined}
                  />
                  {errors.nextActionDue && (
                    <p id="nextActionDue-error" className="mt-1 text-sm text-red-600" role="alert">
                      {errors.nextActionDue.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Link Cover Letter */}
            <div className="flex items-center gap-2">
              <input
                id="linkCoverLetter"
                type="checkbox"
                {...register('linkCoverLetter')}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <label htmlFor="linkCoverLetter" className="text-sm text-gray-700">
                Link cover letter
              </label>
            </div>

            {/* Cover Letter Picker (shown when checkbox is checked) */}
            {linkCoverLetter && (
              <div>
                <label
                  htmlFor="coverLetterId"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Select Cover Letter
                </label>
                <select
                  id="coverLetterId"
                  {...register('coverLetterId')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">-- Select a cover letter --</option>
                  <option value="1">Generic Software Engineer Letter</option>
                  <option value="2">Frontend Specialist Letter</option>
                </select>
              </div>
            )}

            {/* Form Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Save Application'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
