import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect } from 'react';
import type { PersonalInfo, UpdatePersonalInfoRequest } from '../services/api/types';

const optionalUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .max(500)
  .nullable()
  .optional()
  .or(z.literal(''));

const personalInfoFormSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(100, 'First name must be less than 100 characters'),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be less than 100 characters'),
  email: z
    .string()
    .email('Must be a valid email address')
    .max(200, 'Email must be less than 200 characters'),
  phone: z.string().min(1).max(30).optional().or(z.literal('')),
  addressLine1: z.string().min(1).max(200).optional().or(z.literal('')),
  addressLine2: z.string().min(1).max(200).optional().or(z.literal('')),
  city: z.string().min(1).max(100).optional().or(z.literal('')),
  state: z.string().min(1).max(100).optional().or(z.literal('')),
  postalCode: z.string().min(1).max(20).optional().or(z.literal('')),
  country: z.string().min(1).max(100).optional().or(z.literal('')),
  linkedinUrl: z
    .string()
    .min(1, 'LinkedIn URL is required')
    .url('Must be a valid URL')
    .max(500, 'URL must be less than 500 characters'),
  githubUrl: optionalUrlSchema,
  portfolioUrl: optionalUrlSchema,
  websiteUrl: optionalUrlSchema,
  professionalSummary: z.string().min(1).max(2000).optional().or(z.literal('')),
  headline: z.string().min(1).max(100).optional().or(z.literal('')),
});

type PersonalInfoFormData = z.infer<typeof personalInfoFormSchema>;

export interface PersonalInfoFormProps {
  personalInfo?: PersonalInfo | null;
  onSubmit: (data: UpdatePersonalInfoRequest) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  showCancel?: boolean;
  hideActions?: boolean;
  formId?: string;
}

export function PersonalInfoForm({
  personalInfo,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
  showCancel = false,
  hideActions = false,
  formId,
}: PersonalInfoFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
  } = useForm<PersonalInfoFormData>({
    resolver: zodResolver(personalInfoFormSchema),
    defaultValues: {
      firstName: personalInfo?.firstName || '',
      lastName: personalInfo?.lastName || '',
      email: personalInfo?.email || '',
      phone: personalInfo?.phone || '',
      addressLine1: personalInfo?.addressLine1 || '',
      addressLine2: personalInfo?.addressLine2 || '',
      city: personalInfo?.city || '',
      state: personalInfo?.state || '',
      postalCode: personalInfo?.postalCode || '',
      country: personalInfo?.country || '',
      linkedinUrl: personalInfo?.linkedinUrl || '',
      githubUrl: personalInfo?.githubUrl || '',
      portfolioUrl: personalInfo?.portfolioUrl || '',
      websiteUrl: personalInfo?.websiteUrl || '',
      professionalSummary: personalInfo?.professionalSummary || '',
      headline: personalInfo?.headline || '',
    },
  });

  useEffect(() => {
    if (personalInfo) {
      reset({
        firstName: personalInfo.firstName || '',
        lastName: personalInfo.lastName || '',
        email: personalInfo.email || '',
        phone: personalInfo.phone || '',
        addressLine1: personalInfo.addressLine1 || '',
        addressLine2: personalInfo.addressLine2 || '',
        city: personalInfo.city || '',
        state: personalInfo.state || '',
        postalCode: personalInfo.postalCode || '',
        country: personalInfo.country || '',
        linkedinUrl: personalInfo.linkedinUrl || '',
        githubUrl: personalInfo.githubUrl || '',
        portfolioUrl: personalInfo.portfolioUrl || '',
        websiteUrl: personalInfo.websiteUrl || '',
        professionalSummary: personalInfo.professionalSummary || '',
        headline: personalInfo.headline || '',
      });
    }
  }, [personalInfo, reset]);

  const handleFormSubmit = async (data: PersonalInfoFormData) => {
    const payload: UpdatePersonalInfoRequest = {
      ...data,
      version: personalInfo?.version,
      phone: data.phone || null,
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      city: data.city || null,
      state: data.state || null,
      postalCode: data.postalCode || null,
      country: data.country || null,
      linkedinUrl: data.linkedinUrl || null,
      githubUrl: data.githubUrl || null,
      portfolioUrl: data.portfolioUrl || null,
      websiteUrl: data.websiteUrl || null,
      professionalSummary: data.professionalSummary || null,
      headline: data.headline || null,
    };

    await onSubmit(payload);
  };

  return (
    <form id={formId} onSubmit={handleSubmit(handleFormSubmit)} className="space-y-6">
      {/* Basic Information */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-neutral-900">Basic Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-neutral-700">
              First Name <span className="text-error-600">*</span>
            </label>
            <input
              {...register('firstName')}
              type="text"
              id="firstName"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Alex"
            />
            {errors.firstName && (
              <p className="mt-1 text-sm text-error-600">{errors.firstName.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-neutral-700">
              Last Name <span className="text-error-600">*</span>
            </label>
            <input
              {...register('lastName')}
              type="text"
              id="lastName"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Johnson"
            />
            {errors.lastName && (
              <p className="mt-1 text-sm text-error-600">{errors.lastName.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-neutral-700">
              Email <span className="text-error-600">*</span>
            </label>
            <input
              {...register('email')}
              type="email"
              id="email"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="alex@example.com"
            />
            {errors.email && <p className="mt-1 text-sm text-error-600">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-neutral-700">
              Phone
            </label>
            <input
              {...register('phone')}
              type="tel"
              id="phone"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="(555) 123-4567"
            />
            {errors.phone && <p className="mt-1 text-sm text-error-600">{errors.phone.message}</p>}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="headline" className="block text-sm font-medium text-neutral-700">
              Professional Headline
            </label>
            <input
              {...register('headline')}
              type="text"
              id="headline"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Senior Software Engineer"
            />
            {errors.headline && (
              <p className="mt-1 text-sm text-error-600">{errors.headline.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Address */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-neutral-900">Address</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="addressLine1" className="block text-sm font-medium text-neutral-700">
              Address Line 1
            </label>
            <input
              {...register('addressLine1')}
              type="text"
              id="addressLine1"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="123 Main St"
            />
            {errors.addressLine1 && (
              <p className="mt-1 text-sm text-error-600">{errors.addressLine1.message}</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="addressLine2" className="block text-sm font-medium text-neutral-700">
              Address Line 2
            </label>
            <input
              {...register('addressLine2')}
              type="text"
              id="addressLine2"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Apt 4B"
            />
            {errors.addressLine2 && (
              <p className="mt-1 text-sm text-error-600">{errors.addressLine2.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="city" className="block text-sm font-medium text-neutral-700">
              City
            </label>
            <input
              {...register('city')}
              type="text"
              id="city"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="San Francisco"
            />
            {errors.city && <p className="mt-1 text-sm text-error-600">{errors.city.message}</p>}
          </div>

          <div>
            <label htmlFor="state" className="block text-sm font-medium text-neutral-700">
              State/Province
            </label>
            <input
              {...register('state')}
              type="text"
              id="state"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="CA"
            />
            {errors.state && <p className="mt-1 text-sm text-error-600">{errors.state.message}</p>}
          </div>

          <div>
            <label htmlFor="postalCode" className="block text-sm font-medium text-neutral-700">
              Postal Code
            </label>
            <input
              {...register('postalCode')}
              type="text"
              id="postalCode"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="94102"
            />
            {errors.postalCode && (
              <p className="mt-1 text-sm text-error-600">{errors.postalCode.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="country" className="block text-sm font-medium text-neutral-700">
              Country
            </label>
            <input
              {...register('country')}
              type="text"
              id="country"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="USA"
            />
            {errors.country && (
              <p className="mt-1 text-sm text-error-600">{errors.country.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Professional Links */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-neutral-900">Professional Links</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="linkedinUrl" className="block text-sm font-medium text-neutral-700">
              LinkedIn URL <span className="text-error-600">*</span>
            </label>
            <input
              {...register('linkedinUrl')}
              type="url"
              id="linkedinUrl"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="https://linkedin.com/in/yourusername"
            />
            {errors.linkedinUrl && (
              <p className="mt-1 text-sm text-error-600">{errors.linkedinUrl.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="githubUrl" className="block text-sm font-medium text-neutral-700">
              GitHub URL
            </label>
            <input
              {...register('githubUrl')}
              type="url"
              id="githubUrl"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="https://github.com/yourusername"
            />
            {errors.githubUrl && (
              <p className="mt-1 text-sm text-error-600">{errors.githubUrl.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="portfolioUrl" className="block text-sm font-medium text-neutral-700">
              Portfolio URL
            </label>
            <input
              {...register('portfolioUrl')}
              type="url"
              id="portfolioUrl"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="https://yourportfolio.com"
            />
            {errors.portfolioUrl && (
              <p className="mt-1 text-sm text-error-600">{errors.portfolioUrl.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="websiteUrl" className="block text-sm font-medium text-neutral-700">
              Personal Website
            </label>
            <input
              {...register('websiteUrl')}
              type="url"
              id="websiteUrl"
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="https://yourwebsite.com"
            />
            {errors.websiteUrl && (
              <p className="mt-1 text-sm text-error-600">{errors.websiteUrl.message}</p>
            )}
          </div>
        </div>
      </div>

      {/* Professional Summary */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-neutral-900">About You</h3>
        <div>
          <label
            htmlFor="professionalSummary"
            className="block text-sm font-medium text-neutral-700"
          >
            Professional Summary
          </label>
          <textarea
            {...register('professionalSummary')}
            id="professionalSummary"
            rows={4}
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder="Brief summary of your professional background and expertise..."
          />
          {errors.professionalSummary && (
            <p className="mt-1 text-sm text-error-600">{errors.professionalSummary.message}</p>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            This summary will be used in your resume and cover letters.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      {!hideActions && (
        <div className="flex gap-3 border-t border-neutral-200 pt-6">
          {showCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || !isDirty}
            className="flex-1 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}
