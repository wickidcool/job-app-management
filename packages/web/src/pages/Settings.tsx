import { useState } from 'react';
import { Breadcrumb } from '../components/Breadcrumb';
import { PersonalInfoForm } from '../components/PersonalInfoForm';
import { usePersonalInfo, useUpdatePersonalInfo } from '../hooks/usePersonalInfo';
import type { UpdatePersonalInfoRequest } from '../services/api/types';

export function Settings() {
  const breadcrumbTrail = [{ label: 'Dashboard', href: '/', icon: '🏠' }, { label: 'Settings' }];
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const { data, isLoading, error } = usePersonalInfo();
  const updateMutation = useUpdatePersonalInfo();

  const handleSubmit = async (formData: UpdatePersonalInfoRequest) => {
    try {
      await updateMutation.mutateAsync(formData);
      setSuccessMessage('Personal information updated successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to update personal information:', err);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Settings</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Manage your profile, preferences, and integrations
        </p>
      </div>

      {successMessage && (
        <div className="mb-6 rounded-md bg-success-50 p-4">
          <p className="text-sm text-success-800">{successMessage}</p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-md bg-error-50 p-4">
          <p className="text-sm text-error-800">Failed to load personal information</p>
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-xl font-semibold text-neutral-900">Personal Information</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent"></div>
          </div>
        ) : (
          <PersonalInfoForm
            personalInfo={data?.personalInfo}
            onSubmit={handleSubmit}
            submitLabel="Save Changes"
          />
        )}
      </div>
    </div>
  );
}
