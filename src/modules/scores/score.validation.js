const { z } = require('zod');

// Helper to validate YYYY-MM-DD date string & non-future constraint
const isNonFutureDateString = (dateStr) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(date.getTime())) {
    return false;
  }

  // Get current date string in YYYY-MM-DD UTC
  const todayStr = new Date().toISOString().split('T')[0];
  return dateStr <= todayStr;
};

const addScoreSchema = z.object({
  body: z.object({
    score: z
      .number({
        required_error: 'Score is required',
        invalid_type_error: 'Score must be a number',
      })
      .int('Score must be an integer')
      .min(1, 'Score must be at least 1')
      .max(45, 'Score cannot exceed 45'),
    played_on: z
      .string({ required_error: 'Played on date is required' })
      .refine(isNonFutureDateString, {
        message: 'Played on date must be a valid date string in YYYY-MM-DD format and cannot be in the future',
      }),
  }),
});

const updateScoreSchema = z.object({
  params: z.object({
    id: z.string().uuid('Score ID must be a valid UUID'),
  }),
  body: z.object({
    score: z
      .number({ invalid_type_error: 'Score must be a number' })
      .int('Score must be an integer')
      .min(1, 'Score must be at least 1')
      .max(45, 'Score cannot exceed 45')
      .optional(),
    played_on: z
      .string()
      .refine(isNonFutureDateString, {
        message: 'Played on date must be a valid date string in YYYY-MM-DD format and cannot be in the future',
      })
      .optional(),
  }),
});

const scoreIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Score ID must be a valid UUID'),
  }),
});

module.exports = {
  addScoreSchema,
  updateScoreSchema,
  scoreIdParamSchema,
};
