import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ApplicationForm } from '../components/ApplicationForm';
import { useCreateApplication } from '../hooks/useApplications';
import type { ApplicationFormData } from '../types/application';

interface LocationState {
  jobTitle?: string;
  location?: string;
  salaryRange?: string;
  jobDescription?: string;
}

export function ApplicationNew() {
  const navigate = useNavigate();
  const location = useLocation();
  const createMutation = useCreateApplication();
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdApplicationId, setCreatedApplicationId] = useState<string | null>(null);

  const defaultValues = location.state as LocationState | null;

  const handleSubmit = async (data: ApplicationFormData) => {
    const application = await createMutation.mutateAsync(data);
    setCreatedApplicationId(application.id);
    setShowSuccessModal(true);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !createdApplicationId) {
      navigate('/applications');
    }
  };

  const handleSuccessModalClose = () => {
    setShowSuccessModal(false);
    navigate('/applications');
  };

  const handleGenerateCoverLetter = () => {
    setShowSuccessModal(false);
    navigate('/cover-letters/new', {
      state: {
        applicationId: createdApplicationId,
      },
    });
  };

  return (
    <>
      <ApplicationForm
        open={true}
        onOpenChange={handleOpenChange}
        onSubmit={handleSubmit}
        mode="create"
        defaultValues={defaultValues ?? undefined}
      />

      {/* Success Modal */}
      <Dialog.Root open={showSuccessModal} onOpenChange={setShowSuccessModal}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl max-w-md w-full p-6 z-50">
            <div className="text-center">
              <div className="text-5xl mb-4">✅</div>
              <Dialog.Title className="text-2xl font-semibold text-neutral-900 mb-2">
                Application Saved!
              </Dialog.Title>
              <Dialog.Description className="text-neutral-600 mb-6">
                Your job application has been saved successfully.
              </Dialog.Description>

              <div className="space-y-3">
                <button
                  onClick={handleGenerateCoverLetter}
                  className="w-full px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                >
                  Generate Cover Letter
                </button>
                <button
                  onClick={handleSuccessModalClose}
                  className="w-full px-6 py-3 text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
                >
                  View Applications
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
