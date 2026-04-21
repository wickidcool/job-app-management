import { useNavigate } from 'react-router-dom';
import { ApplicationForm } from '../components/ApplicationForm';
import { useCreateApplication } from '../hooks/useApplications';
import type { ApplicationFormData } from '../types/application';

export function ApplicationNew() {
  const navigate = useNavigate();
  const createMutation = useCreateApplication();

  const handleSubmit = async (data: ApplicationFormData) => {
    const application = await createMutation.mutateAsync(data);
    navigate(`/applications/${application.id}`);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      navigate('/applications');
    }
  };

  return (
    <ApplicationForm
      open={true}
      onOpenChange={handleOpenChange}
      onSubmit={handleSubmit}
      mode="create"
    />
  );
}
