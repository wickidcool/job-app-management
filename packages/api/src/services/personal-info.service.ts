import { eq, isNull, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { getDb } from '../db/client.js';
import { personalInfo, type PersonalInfo } from '../db/schema.js';
import { VersionConflictError } from '../types/index.js';

export interface UpsertPersonalInfoInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  professionalSummary?: string | null;
  headline?: string | null;
  version?: number;
}

export interface PersonalInfoWithCompletion {
  personalInfo: PersonalInfo;
  isComplete: boolean;
  completionPercentage: number;
}

function userFilter(userId?: string) {
  return userId ? eq(personalInfo.userId, userId) : isNull(personalInfo.userId);
}

function calculateCompletion(info: PersonalInfo): {
  isComplete: boolean;
  completionPercentage: number;
} {
  const requiredFields = ['firstName', 'lastName', 'email'] as const;
  const optionalFields = [
    'phone',
    'city',
    'state',
    'country',
    'linkedinUrl',
    'githubUrl',
    'headline',
    'professionalSummary',
  ] as const;

  const requiredFilled = requiredFields.filter((f) => info[f]).length;
  const optionalFilled = optionalFields.filter((f) => info[f]).length;

  const isComplete = requiredFilled === requiredFields.length;
  const completionPercentage = Math.round(
    ((requiredFilled + optionalFilled) / (requiredFields.length + optionalFields.length)) * 100
  );

  return { isComplete, completionPercentage };
}

export async function getPersonalInfo(userId?: string): Promise<PersonalInfoWithCompletion> {
  const db = getDb();
  const result = await db.select().from(personalInfo).where(userFilter(userId)).limit(1);

  const info = result[0];

  if (!info) {
    const defaultInfo: PersonalInfo = {
      id: ulid(),
      userId: userId ?? null,
      firstName: '',
      lastName: '',
      email: '',
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
      linkedinUrl: null,
      githubUrl: null,
      portfolioUrl: null,
      websiteUrl: null,
      professionalSummary: null,
      headline: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };

    return {
      personalInfo: defaultInfo,
      isComplete: false,
      completionPercentage: 0,
    };
  }

  const { isComplete, completionPercentage } = calculateCompletion(info);

  return {
    personalInfo: info,
    isComplete,
    completionPercentage,
  };
}

export async function upsertPersonalInfo(
  input: UpsertPersonalInfoInput,
  userId?: string
): Promise<PersonalInfoWithCompletion> {
  const db = getDb();

  const userIdValue = userId ?? null;

  if (userIdValue !== null) {
    const insertValues = {
      id: ulid(),
      userId: userIdValue,
      firstName: input.firstName ?? '',
      lastName: input.lastName ?? '',
      email: input.email ?? '',
      phone: input.phone ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      linkedinUrl: input.linkedinUrl ?? null,
      githubUrl: input.githubUrl ?? null,
      portfolioUrl: input.portfolioUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      professionalSummary: input.professionalSummary ?? null,
      headline: input.headline ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };

    const updateSet: Record<string, unknown> = {
      updatedAt: new Date(),
      version: sql`${personalInfo.version} + 1`,
    };

    if (input.firstName !== undefined) updateSet.firstName = input.firstName;
    if (input.lastName !== undefined) updateSet.lastName = input.lastName;
    if (input.email !== undefined) updateSet.email = input.email;
    if (input.phone !== undefined) updateSet.phone = input.phone;
    if (input.addressLine1 !== undefined) updateSet.addressLine1 = input.addressLine1;
    if (input.addressLine2 !== undefined) updateSet.addressLine2 = input.addressLine2;
    if (input.city !== undefined) updateSet.city = input.city;
    if (input.state !== undefined) updateSet.state = input.state;
    if (input.postalCode !== undefined) updateSet.postalCode = input.postalCode;
    if (input.country !== undefined) updateSet.country = input.country;
    if (input.linkedinUrl !== undefined) updateSet.linkedinUrl = input.linkedinUrl;
    if (input.githubUrl !== undefined) updateSet.githubUrl = input.githubUrl;
    if (input.portfolioUrl !== undefined) updateSet.portfolioUrl = input.portfolioUrl;
    if (input.websiteUrl !== undefined) updateSet.websiteUrl = input.websiteUrl;
    if (input.professionalSummary !== undefined)
      updateSet.professionalSummary = input.professionalSummary;
    if (input.headline !== undefined) updateSet.headline = input.headline;

    if (input.version !== undefined) {
      updateSet.version = sql`CASE WHEN ${personalInfo.version} = ${input.version} THEN ${personalInfo.version} + 1 ELSE ${personalInfo.version} END`;
    }

    const [result] = await db
      .insert(personalInfo)
      .values(insertValues)
      .onConflictDoUpdate({
        target: personalInfo.userId,
        set: updateSet,
      })
      .returning();

    if (input.version !== undefined && result.version !== input.version + 1) {
      throw new VersionConflictError();
    }

    const { isComplete, completionPercentage } = calculateCompletion(result);

    return {
      personalInfo: result,
      isComplete,
      completionPercentage,
    };
  } else {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(personalInfo)
        .where(isNull(personalInfo.userId))
        .limit(1)
        .for('update');

      if (!existing || existing.length === 0) {
        const [created] = await tx
          .insert(personalInfo)
          .values({
            id: ulid(),
            userId: null,
            firstName: input.firstName ?? '',
            lastName: input.lastName ?? '',
            email: input.email ?? '',
            phone: input.phone ?? null,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
            country: input.country ?? null,
            linkedinUrl: input.linkedinUrl ?? null,
            githubUrl: input.githubUrl ?? null,
            portfolioUrl: input.portfolioUrl ?? null,
            websiteUrl: input.websiteUrl ?? null,
            professionalSummary: input.professionalSummary ?? null,
            headline: input.headline ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
          })
          .returning();

        const { isComplete, completionPercentage } = calculateCompletion(created);

        return {
          personalInfo: created,
          isComplete,
          completionPercentage,
        };
      }

      const record = existing[0];

      if (input.version !== undefined && input.version !== record.version) {
        throw new VersionConflictError();
      }

      const updateSet: Record<string, unknown> = {
        updatedAt: new Date(),
        version: record.version + 1,
      };

      if (input.firstName !== undefined) updateSet.firstName = input.firstName;
      if (input.lastName !== undefined) updateSet.lastName = input.lastName;
      if (input.email !== undefined) updateSet.email = input.email;
      if (input.phone !== undefined) updateSet.phone = input.phone;
      if (input.addressLine1 !== undefined) updateSet.addressLine1 = input.addressLine1;
      if (input.addressLine2 !== undefined) updateSet.addressLine2 = input.addressLine2;
      if (input.city !== undefined) updateSet.city = input.city;
      if (input.state !== undefined) updateSet.state = input.state;
      if (input.postalCode !== undefined) updateSet.postalCode = input.postalCode;
      if (input.country !== undefined) updateSet.country = input.country;
      if (input.linkedinUrl !== undefined) updateSet.linkedinUrl = input.linkedinUrl;
      if (input.githubUrl !== undefined) updateSet.githubUrl = input.githubUrl;
      if (input.portfolioUrl !== undefined) updateSet.portfolioUrl = input.portfolioUrl;
      if (input.websiteUrl !== undefined) updateSet.websiteUrl = input.websiteUrl;
      if (input.professionalSummary !== undefined)
        updateSet.professionalSummary = input.professionalSummary;
      if (input.headline !== undefined) updateSet.headline = input.headline;

      const [updated] = await tx
        .update(personalInfo)
        .set(updateSet)
        .where(eq(personalInfo.id, record.id))
        .returning();

      if (!updated) {
        throw new VersionConflictError();
      }

      const { isComplete, completionPercentage } = calculateCompletion(updated);

      return {
        personalInfo: updated,
        isComplete,
        completionPercentage,
      };
    });
  }
}
