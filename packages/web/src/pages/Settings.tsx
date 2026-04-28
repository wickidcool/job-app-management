import { Breadcrumb } from '../components/Breadcrumb';

export function Settings() {
  const breadcrumbTrail = [{ label: 'Dashboard', href: '/', icon: '🏠' }, { label: 'Settings' }];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumb trail={breadcrumbTrail} />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-neutral-900">Settings</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Manage your profile, preferences, and integrations
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold text-neutral-900">Profile</h3>
          <p className="text-sm text-neutral-600">
            Update your personal information and contact details
          </p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold text-neutral-900">Preferences</h3>
          <p className="text-sm text-neutral-600">
            Customize your application tracking preferences
          </p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold text-neutral-900">Integrations</h3>
          <p className="text-sm text-neutral-600">Connect with external services and tools</p>
        </div>
      </div>
    </div>
  );
}
