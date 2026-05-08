import { eq, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { personalInfo, type PersonalInfo } from '../db/schema.js';
import { VersionConflictError } from '../types/index.js';

export interface UpsertPersonalInfoInput {
  fullName?: string | null;
  email?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  homeAddress?: string | null;
  phoneNumber?: string | null;
  projectsWebsite?: string | null;
  publishingPlatforms?: string[];
  version?: number;
}

function userFilter(userId?: string) {
  return userId ? eq(personalInfo.userId, userId) : isNull(personalInfo.userId);
}

export async function getPersonalInfo(userId?: string): Promise<PersonalInfo | null> {
  const db = getDb();
  const result = await db.select().from(personalInfo).where(userFilter(userId)).limit(1);
  return result[0] ?? null;
}

export async function upsertPersonalInfo(
  input: UpsertPersonalInfoInput,
  userId?: string
): Promise<PersonalInfo> {
  const db = getDb();
  const existing = await getPersonalInfo(userId);

  if (!existing) {
    const [created] = await db
      .insert(personalInfo)
      .values({
        id: ulid(),
        userId: userId ?? null,
        fullName: input.fullName ?? null,
        email: input.email ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        githubUrl: input.githubUrl ?? null,
        homeAddress: input.homeAddress ?? null,
        phoneNumber: input.phoneNumber ?? null,
        projectsWebsite: input.projectsWebsite ?? null,
        publishingPlatforms: input.publishingPlatforms ?? [],
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      })
      .returning();
    return created;
  }

  if (input.version !== undefined && input.version !== existing.version) {
    throw new VersionConflictError();
  }

  const [updated] = await db
    .update(personalInfo)
    .set({
      fullName: input.fullName ?? null,
      email: input.email ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      githubUrl: input.githubUrl ?? null,
      homeAddress: input.homeAddress ?? null,
      phoneNumber: input.phoneNumber ?? null,
      projectsWebsite: input.projectsWebsite ?? null,
      publishingPlatforms: input.publishingPlatforms ?? [],
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(eq(personalInfo.id, existing.id))
    .returning();

  if (!updated) {
    throw new VersionConflictError();
  }

  return updated;
}
