import type { Application, ApplicationFormData, ApplicationStatus } from '../types/application';

// Mock application data
const mockApplications: Application[] = [
  {
    id: '1',
    jobTitle: 'Senior Frontend Engineer',
    company: 'TechCorp Inc',
    location: 'San Francisco, CA',
    salaryRange: '$140k - $180k',
    url: 'https://example.com/jobs/senior-frontend',
    status: 'applied',
    hasDocuments: true,
    createdAt: new Date('2024-04-10'),
    appliedAt: new Date('2024-04-12'),
    updatedAt: new Date('2024-04-12'),
  },
  {
    id: '2',
    jobTitle: 'React Developer',
    company: 'StartupXYZ',
    location: 'Remote',
    salaryRange: '$120k - $150k',
    status: 'phone_screen',
    hasDocuments: false,
    createdAt: new Date('2024-04-08'),
    appliedAt: new Date('2024-04-09'),
    updatedAt: new Date('2024-04-13'),
  },
  {
    id: '3',
    jobTitle: 'Full Stack Engineer',
    company: 'BigTech Co',
    location: 'New York, NY',
    salaryRange: '$150k - $200k',
    url: 'https://example.com/jobs/fullstack',
    jobDescription: 'Building scalable web applications',
    status: 'interview',
    hasDocuments: true,
    createdAt: new Date('2024-04-05'),
    appliedAt: new Date('2024-04-06'),
    updatedAt: new Date('2024-04-14'),
  },
  {
    id: '4',
    jobTitle: 'UI/UX Engineer',
    company: 'Design Studio',
    location: 'Austin, TX',
    status: 'saved',
    hasDocuments: false,
    createdAt: new Date('2024-04-14'),
    updatedAt: new Date('2024-04-14'),
  },
  {
    id: '5',
    jobTitle: 'TypeScript Developer',
    company: 'Cloud Services Inc',
    location: 'Seattle, WA',
    salaryRange: '$130k - $170k',
    status: 'rejected',
    hasDocuments: false,
    createdAt: new Date('2024-03-28'),
    appliedAt: new Date('2024-03-29'),
    updatedAt: new Date('2024-04-10'),
  },
];

// In-memory store (simulates API state)
let applications = [...mockApplications];
let nextId = 6;

// Simulated API delay
const delay = (ms: number = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockApplicationService = {
  /**
   * Get all applications
   */
  async getAll(): Promise<Application[]> {
    await delay();
    return [...applications];
  },

  /**
   * Get application by ID
   */
  async getById(id: string): Promise<Application | null> {
    await delay();
    return applications.find((app) => app.id === id) || null;
  },

  /**
   * Create new application
   */
  async create(data: ApplicationFormData): Promise<Application> {
    await delay();
    const newApp: Application = {
      id: String(nextId++),
      ...data,
      hasDocuments: false,
      createdAt: new Date(),
      appliedAt: data.status !== 'saved' ? new Date() : undefined,
      updatedAt: new Date(),
    };
    applications.push(newApp);
    return newApp;
  },

  /**
   * Update existing application
   */
  async update(id: string, data: Partial<ApplicationFormData>): Promise<Application> {
    await delay();
    const index = applications.findIndex((app) => app.id === id);
    if (index === -1) {
      throw new Error(`Application with id ${id} not found`);
    }

    const updated: Application = {
      ...applications[index],
      ...data,
      updatedAt: new Date(),
      appliedAt:
        data.status && data.status !== 'saved' && !applications[index].appliedAt
          ? new Date()
          : applications[index].appliedAt,
    };

    applications[index] = updated;
    return updated;
  },

  /**
   * Update application status
   */
  async updateStatus(id: string, status: ApplicationStatus): Promise<Application> {
    return this.update(id, { status });
  },

  /**
   * Delete application
   */
  async delete(id: string): Promise<void> {
    await delay();
    applications = applications.filter((app) => app.id !== id);
  },

  /**
   * Reset to initial mock data (for testing)
   */
  reset(): void {
    applications = [...mockApplications];
    nextId = 6;
  },
};
